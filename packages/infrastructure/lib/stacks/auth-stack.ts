import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { AppConfig } from '../config';

interface AuthStackProps extends cdk.StackProps {
  config: AppConfig;
  audioBucket: s3.Bucket;
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config, audioBucket } = props;

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'MeetingPlatformUsers',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: false,
          mutable: true,
        },
        familyName: {
          required: false,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: true,
        otp: true,
      },
      userVerification: {
        emailSubject: 'Verify your email for Meeting Analysis Platform',
        emailBody: 'Thank you for signing up! Your verification code is {####}',
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      signInCaseSensitive: false,
      deletionProtection: false,
    });

    // User Pool Client with OAuth enabled for Cognito Hosted UI
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: 'MeetingPlatform-WebClient',
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
        adminUserPassword: false,
      },
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.minutes(10),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.hours(10),
      enableTokenRevocation: true,
      authSessionValidity: cdk.Duration.minutes(3),
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        // Initial callback URLs (will be updated with CloudFront URL after deployment)
        callbackUrls: ['http://localhost:5173/dashboard/'],
        logoutUrls: ['http://localhost:5173/'],
      },
    });

    // User Pool Domain for OAuth flows (needed to configure OIDC provider redirect URIs)
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: process.env.COGNITO_DOMAIN_PREFIX || `meeting-platform-${this.account}`,
      },
    });

    // Cognito Identity Pool for S3 upload credentials
    this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: 'MeetingPlatformIdentityPool',
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
          serverSideTokenCheck: true,
        },
      ],
    });

    // IAM Role for authenticated users
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
    });

    // Grant S3 upload permissions to authenticated users
    audioBucket.grantPut(authenticatedRole, 'uploads/*');
    audioBucket.grantRead(authenticatedRole, 'uploads/*');

    // Attach role to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: 'MeetingPlatform-UserPoolId',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: 'MeetingPlatform-UserPoolClientId',
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: 'MeetingPlatform-IdentityPoolId',
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS Region',
      exportName: 'MeetingPlatform-Region',
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: this.userPoolDomain.domainName,
      description: 'Cognito User Pool Domain',
      exportName: 'MeetingPlatform-UserPoolDomain',
    });

    new cdk.CfnOutput(this, 'CognitoHostedUIUrl', {
      value: `https://${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI Base URL',
    });
  }
}
