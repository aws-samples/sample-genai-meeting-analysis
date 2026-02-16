import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiEndpointProps {
  resource: apigateway.IResource;
  method: string;
  lambdaFunction: lambda.Function;
  authorizer?: apigateway.IAuthorizer;
  requireAuth?: boolean;
  requestValidator?: apigateway.IRequestValidator;
  requestModels?: { [contentType: string]: apigateway.IModel };
}

export class ApiEndpoint extends Construct {
  public readonly method: apigateway.Method;

  constructor(scope: Construct, id: string, props: ApiEndpointProps) {
    super(scope, id);

    const {
      resource,
      method,
      lambdaFunction,
      authorizer,
      requireAuth = true,
      requestValidator,
      requestModels,
    } = props;

    // Lambda integration
    const integration = new apigateway.LambdaIntegration(lambdaFunction, {
      proxy: true,
      allowTestInvoke: true,
    });

    // Add method to resource
    this.method = resource.addMethod(method, integration, {
      authorizer: requireAuth ? authorizer : undefined,
      authorizationType: requireAuth
        ? apigateway.AuthorizationType.COGNITO
        : apigateway.AuthorizationType.NONE,
      requestValidator,
      requestModels,
    });
  }
}
