## Serverless Meeting Analyzer

A serverless web application for uploading, transcribing, and analyzing meeting recordings using AWS services.

### Architecture

![Architecture Diagram](meeting-platform-architecture.png)

- **Frontend**: React + Vite + AWS Cloudscape, hosted on S3/CloudFront
- **API**: API Gateway + Lambda (TypeScript)
- **Storage**: DynamoDB + S3
- **AI**: Amazon Transcribe + Amazon Bedrock
- **Auth**: Amazon Cognito

### Quick Start

#### 1. Deploy Infrastructure

```bash
# Install dependencies
npm install

# Build the shared dependencies
npm run build --workspace=packages/shared

# Build the frontend
npm run build --workspace=packages/frontend

# Deploy all infrastructure
cd packages/infrastructure
cdk bootstrap
npm run deploy:all
```

This deploys all stacks and automatically configures CloudFront callback URLs.

#### 2. Create a Cognito User (Required for Testing)

Before using the application, you must create a user in Cognito:

1. Go to the [AWS Cognito Console](https://console.aws.amazon.com/cognito)
2. Select your User Pool (created during deployment)
3. Go to **Users** → **Create user**
4. Fill in the required fields:
   - Username (email)
   - Temporary password
5. Click **Create user**
6. On first login, you'll be prompted to set a permanent password

#### 3. Access Your Application

- **Production**: `https://<cloudfront-domain>` (from deployment output)
- **Local Development**: `http://localhost:5173` (see below)

#### 4. Configure Word Template

After logging in:

1. Go to **Settings** in the application
2. Upload a Word template (`.docx` file)
3. Ensure your template contains `{{placeholders}}` for dynamic content replacement
4. The application will autocomplete available placeholders based on your template

Example placeholders you might use:
- `{{meeting_title}}`
- `{{meeting_date}}`
- `{{attendees}}`
- `{{summary}}`
- `{{action_items}}`

### Run Frontend Locally

```bash
# Build shared types
cd packages/shared && npm run build

# Configure frontend environment with values retrieved from your cdk output or AWS console
cd packages/frontend
cp .env.example .env.local
# Edit .env.local with values from your CDK deployment outputs
```

Example `packages/frontend/.env.local`:
```bash
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
VITE_COGNITO_DOMAIN=meeting-platform-xxxxxxxxx.auth.us-east-1.amazoncognito.com
VITE_API_URL=https://<cloudfront-domain>/api
VITE_AWS_REGION=us-east-1
```

```bash
# Start frontend dev server
npm run dev
```

Frontend runs at `http://localhost:5173` and uses the deployed backend.

### Sample Data

The `sample/` folder includes files you can use to quickly test the application without recording a real meeting:

- `board-meeting-sample.mp3` — A sample board meeting audio recording. Upload this through the application to test the full transcription and analysis pipeline.
- `report-template.docx` — A Word template with `{{placeholders}}` for generating formatted meeting reports. Upload it in **Settings** → **Word Template**.
- `report-template.md` — The markdown version of the report template, for reference.
- `script.json` — The meeting script used to generate the sample audio, useful for verifying transcription accuracy.

To try it out:

1. Deploy the application and log in (see Quick Start above)
2. Upload `sample/report-template.docx` as your Word template in **Settings**
3. Upload `sample/board-meeting-sample.mp3` as a new meeting recording
4. Wait for transcription and analysis to complete, then review the generated report

### Project Structure

```
meeting-analysis-platform/
├── packages/
│   ├── shared/          # Shared TypeScript types and interfaces
│   ├── frontend/        # React frontend application
│   └── infrastructure/  # AWS CDK infrastructure code
└── package.json         # Root workspace configuration
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

