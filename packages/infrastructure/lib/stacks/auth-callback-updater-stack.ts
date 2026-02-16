import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { AppConfig } from '../config';

interface AuthCallbackUpdaterStackProps extends cdk.StackProps {
  config: AppConfig;
  userPoolClient: cognito.UserPoolClient;
  userPoolId: string;
  cloudfrontDomain: string;
}

export class AuthCallbackUpdaterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AuthCallbackUpdaterStackProps) {
    super(scope, id, props);

    const { userPoolClient, userPoolId, cloudfrontDomain } = props;

    // Build callback URLs
    const callbackUrls = [
      `https://${cloudfrontDomain}/dashboard/`,
      'http://localhost:5173/dashboard/',
    ];

    if (process.env.OAUTH_CALLBACK_URLS) {
      callbackUrls.push(
        ...process.env.OAUTH_CALLBACK_URLS.split(',').filter((url) => url.trim())
      );
    }

    // Build logout URLs
    const logoutUrls = [
      `https://${cloudfrontDomain}/`,
      'http://localhost:5173/',
    ];

    if (process.env.OAUTH_LOGOUT_URLS) {
      logoutUrls.push(
        ...process.env.OAUTH_LOGOUT_URLS.split(',').filter((url) => url.trim())
      );
    }

    // Update User Pool Client with new callback URLs
    // We need to provide the OAuth configuration explicitly because updateUserPoolClient
    // requires all OAuth settings to be provided together
    const updateParams: any = {
      UserPoolId: userPoolId,
      ClientId: userPoolClient.userPoolClientId,
      CallbackURLs: callbackUrls,
      LogoutURLs: logoutUrls,
      // OAuth configuration from Auth Stack
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: ['email', 'openid', 'profile', 'aws.cognito.signin.user.admin'],
      AllowedOAuthFlowsUserPoolClient: true,
      SupportedIdentityProviders: ['COGNITO'],
    };

    new cr.AwsCustomResource(this, 'UpdateCallbackUrls', {
      onCreate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: updateParams,
        physicalResourceId: cr.PhysicalResourceId.of(
          `callback-urls-${userPoolClient.userPoolClientId}`
        ),
      },
      onUpdate: {
        service: 'CognitoIdentityServiceProvider',
        action: 'updateUserPoolClient',
        parameters: updateParams,
        physicalResourceId: cr.PhysicalResourceId.of(
          `callback-urls-${userPoolClient.userPoolClientId}`
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['cognito-idp:UpdateUserPoolClient'],
          resources: [
            `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${userPoolId}`,
          ],
        }),
      ]),
    });

    new cdk.CfnOutput(this, 'UpdatedCallbackUrls', {
      value: JSON.stringify(callbackUrls),
      description: 'Updated OAuth callback URLs',
    });

    new cdk.CfnOutput(this, 'UpdatedLogoutUrls', {
      value: JSON.stringify(logoutUrls),
      description: 'Updated OAuth logout URLs',
    });
  }
}
