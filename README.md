#  Backend server application 

AWS Elastic Beanstalk backend for video downloader service.

## Deployment

1. Install EB CLI
2. Initialize: `eb init savemedia-backend --platform node.js --region us-east-1`
3. Create environment: `eb create savemedia-prod`
4. Deploy: `eb deploy`

## Environment Variables

- `NODE_ENV=production`
- `PORT=8080`

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/info` - Get video info
- `POST /api/download` - Download video
- `GET /api/platforms` - List supported platforms



# Initialize EB
eb init savemedia-backend --platform node.js --region us-east-1

# Create environment
eb create savemedia-prod --envvars NODE_ENV=production

# Deploy
eb deploy savemedia-prod

# Check status
eb status

# View logs
eb logs


🔗 Frontend API URL Update
const API_BASE_URL = 'https://your-app.elasticbeanstalk.com/api';
