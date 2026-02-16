import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import { AppConfig } from '../config';

interface MonitoringStackProps extends cdk.StackProps {
  config: AppConfig;
  api: apigateway.RestApi;
  lambdaFunctions: lambda.Function[];
  updatePlaceholderFunction?: lambda.Function;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config, api, lambdaFunctions, updatePlaceholderFunction } = props;

    // SNS Topic for alarms (optional - can be configured later)
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Meeting Platform Alarms',
    });

    // CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'MeetingPlatform',
    });

    // API Gateway Metrics
    const apiCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api4xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4XXError',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const api5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Requests',
        left: [apiCountMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Errors',
        left: [api4xxMetric, api5xxMetric],
        width: 12,
      })
    );

    // API Gateway 5xx Error Alarm
    const api5xxAlarm = new cloudwatch.Alarm(this, 'Api5xxAlarm', {
      metric: api5xxMetric,
      threshold: 10,
      evaluationPeriods: 2,
      alarmDescription: 'Alert when API Gateway 5xx errors exceed threshold',
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (config.enableDetailedMonitoring) {
      api5xxAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
    }

    // Lambda Function Metrics (will be populated when functions are added)
    if (lambdaFunctions.length > 0) {
      const lambdaErrorMetrics = lambdaFunctions.map((fn) =>
        fn.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) })
      );

      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Lambda Errors',
          left: lambdaErrorMetrics,
          width: 12,
        })
      );

      // Lambda Error Alarms
      lambdaFunctions.forEach((fn, index) => {
        const alarm = new cloudwatch.Alarm(this, `LambdaErrorAlarm${index}`, {
          metric: fn.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
          threshold: 5,
          evaluationPeriods: 2,
          alarmDescription: `Alert when ${fn.functionName} errors exceed threshold`,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        if (config.enableDetailedMonitoring) {
          alarm.addAlarmAction(new actions.SnsAction(alarmTopic));
        }
      });
    }

    // Placeholder Edit Operations Monitoring
    if (updatePlaceholderFunction) {
      // Custom metrics for placeholder edit operations
      const editSuccessMetric = new cloudwatch.Metric({
        namespace: 'MeetingPlatform/PlaceholderEdits',
        metricName: 'EditSuccess',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });

      const editFailureMetric = new cloudwatch.Metric({
        namespace: 'MeetingPlatform/PlaceholderEdits',
        metricName: 'EditFailure',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });

      const concurrentEditConflictMetric = new cloudwatch.Metric({
        namespace: 'MeetingPlatform/PlaceholderEdits',
        metricName: 'ConcurrentEditConflict',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      });

      const editLatencyMetric = updatePlaceholderFunction.metricDuration({
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      });

      const editLatencyP95Metric = updatePlaceholderFunction.metricDuration({
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      });

      // Add placeholder edit widgets to dashboard
      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Placeholder Edit Operations',
          left: [editSuccessMetric, editFailureMetric],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'Placeholder Edit Latency',
          left: [editLatencyMetric, editLatencyP95Metric],
          width: 12,
        })
      );

      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Concurrent Edit Conflicts',
          left: [concurrentEditConflictMetric],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'UpdatePlaceholder Function Errors',
          left: [updatePlaceholderFunction.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) })],
          width: 12,
        })
      );

      // Alarm: Edit save failure rate > 5%
      const editFailureRateAlarm = new cloudwatch.Alarm(this, 'EditFailureRateAlarm', {
        metric: new cloudwatch.MathExpression({
          expression: '(failures / (successes + failures)) * 100',
          usingMetrics: {
            failures: editFailureMetric,
            successes: editSuccessMetric,
          },
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        evaluationPeriods: 2,
        alarmDescription: 'Alert when placeholder edit failure rate exceeds 5%',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });

      if (config.enableDetailedMonitoring) {
        editFailureRateAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
      }

      // Alarm: Edit save latency p95 > 2 seconds
      const editLatencyAlarm = new cloudwatch.Alarm(this, 'EditLatencyAlarm', {
        metric: editLatencyP95Metric,
        threshold: 2000, // 2 seconds in milliseconds
        evaluationPeriods: 2,
        alarmDescription: 'Alert when placeholder edit p95 latency exceeds 2 seconds',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });

      if (config.enableDetailedMonitoring) {
        editLatencyAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
      }

      // Alarm: Concurrent edit conflict rate > 1%
      const concurrentEditConflictRateAlarm = new cloudwatch.Alarm(this, 'ConcurrentEditConflictRateAlarm', {
        metric: new cloudwatch.MathExpression({
          expression: '(conflicts / (successes + failures + conflicts)) * 100',
          usingMetrics: {
            conflicts: concurrentEditConflictMetric,
            successes: editSuccessMetric,
            failures: editFailureMetric,
          },
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 2,
        alarmDescription: 'Alert when concurrent edit conflict rate exceeds 1%',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });

      if (config.enableDetailedMonitoring) {
        concurrentEditConflictRateAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
      }

      // Alarm: UpdatePlaceholder function errors > 10%
      const updatePlaceholderErrorRateAlarm = new cloudwatch.Alarm(this, 'UpdatePlaceholderErrorRateAlarm', {
        metric: new cloudwatch.MathExpression({
          expression: '(errors / invocations) * 100',
          usingMetrics: {
            errors: updatePlaceholderFunction.metricErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
            invocations: updatePlaceholderFunction.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
          },
          period: cdk.Duration.minutes(5),
        }),
        threshold: 10,
        evaluationPeriods: 2,
        alarmDescription: 'Alert when UpdatePlaceholder function error rate exceeds 10%',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });

      if (config.enableDetailedMonitoring) {
        updatePlaceholderErrorRateAlarm.addAlarmAction(new actions.SnsAction(alarmTopic));
      }
    }

    // Outputs
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${config.env.region}#dashboards:name=${this.dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS Topic ARN for alarms',
    });
  }
}
