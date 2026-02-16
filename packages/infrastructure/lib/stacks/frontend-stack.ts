import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { AppConfig } from '../config';
import * as path from 'path';

interface FrontendStackProps extends cdk.StackProps {
  config: AppConfig;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  identityPool: cognito.CfnIdentityPool;
  userPoolDomain: cognito.UserPoolDomain;
  api: apigateway.RestApi;
}

export class FrontendStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly uiBucket: s3.Bucket;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { config } = props;

    // S3 Bucket for UI hosting
    this.uiBucket = new s3.Bucket(this, 'UIBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CloudFront Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for Meeting Platform UI',
    });

    // Grant CloudFront read access to S3 bucket
    this.uiBucket.grantRead(originAccessIdentity);

    // API Gateway origin - extract the domain from the API URL
    // API URL format: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/
    const apiDomainName = `${props.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
    const apiOrigin = new origins.HttpOrigin(apiDomainName, {
      originPath: '/v1', // API Gateway stage name
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // CloudFront Distribution with both S3 (frontend) and API Gateway origins
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(this.uiBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        compress: true,
      },
      additionalBehaviors: {
        // Route /api/* requests to API Gateway
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // Don't cache API responses
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
    });

    // The API URL is now relative (same origin)
    this.apiUrl = '/api';

    // Outputs
    new cdk.CfnOutput(this, 'UIBucketName', {
      value: this.uiBucket.bucketName,
      description: 'S3 bucket name for UI hosting',
      exportName: `${cdk.Stack.of(this).stackName}-UIBucketName`,
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
      exportName: 'MeetingPlatform-Frontend-DistributionDomainName',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `${cdk.Stack.of(this).stackName}-DistributionId`,
    });

    // Output configuration for frontend
    new cdk.CfnOutput(this, 'FrontendConfig', {
      value: JSON.stringify({
        userPoolId: props.userPool.userPoolId,
        userPoolClientId: props.userPoolClient.userPoolClientId,
        identityPoolId: props.identityPool.ref,
        apiUrl: this.apiUrl,
        region: config.env.region,
      }),
      description: 'Frontend configuration (copy to frontend .env)',
    });

    // Generate runtime configuration file
    const runtimeConfig = `window.APP_CONFIG = ${JSON.stringify({
      userPoolId: props.userPool.userPoolId,
      userPoolClientId: props.userPoolClient.userPoolClientId,
      identityPoolId: props.identityPool.ref,
      cognitoDomain: `${props.userPoolDomain.domainName}.auth.${config.env.region}.amazoncognito.com`,
      apiUrl: this.apiUrl,
      region: config.env.region,
    }, null, 2)};`;

    // Deploy frontend build to S3
    // Note: The frontend must be built before CDK deployment
    const frontendPath = path.join(__dirname, '../../../frontend/dist');
    
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset(frontendPath),
        s3deploy.Source.data('config.js', runtimeConfig),
      ],
      destinationBucket: this.uiBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      cacheControl: [
        s3deploy.CacheControl.fromString('public, max-age=31536000, immutable'),
      ],
      exclude: ['index.html', 'config.js'],
    });

    // Deploy index.html and config.js separately with no-cache
    new s3deploy.BucketDeployment(this, 'DeployFrontendIndex', {
      sources: [
        s3deploy.Source.asset(frontendPath),
        s3deploy.Source.data('config.js', runtimeConfig),
      ],
      destinationBucket: this.uiBucket,
      distribution: this.distribution,
      distributionPaths: ['/index.html', '/config.js'],
      cacheControl: [
        s3deploy.CacheControl.fromString('no-cache, no-store, must-revalidate'),
      ],
      include: ['index.html', 'config.js'],
    });
  }
}
