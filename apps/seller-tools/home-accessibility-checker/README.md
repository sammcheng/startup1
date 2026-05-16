# Express.js Accessibility Checker Backend

A fast Express.js backend for home accessibility analysis, optimized for Hackmarket tool routing and quick cold-start recovery. The service supports direct image uploads and listing-URL scraping, then combines vision and LLM-based accessibility analysis.

## 🚀 Quick Start

### Prerequisites

- Node.js 22.x
- OpenRouter API key (recommended for production analysis)
- npm or yarn

### Installation

```bash
# Clone and navigate to the seller tool
cd apps/seller-tools/home-accessibility-checker

# Install dependencies
npm ci

# Copy environment file
cp env.example .env

# Edit .env with your OpenRouter API key
OPENROUTER_API_KEY=your_openrouter_api_key_here

# Start development server
npm run dev
```

### Production Deployment

#### Railway (Recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Deploy
railway up
```

#### Render

```bash
# Connect your GitHub repo to Render
# Set environment variables in Render dashboard
# Deploy automatically on git push
```

## 📡 API Endpoints

### Health Check

```http
GET /health
```

### Upload Images

```http
POST /api/upload
Content-Type: multipart/form-data

# Form data:
images: [file1, file2, ...] (max 5 files, 10MB each)
```

### Analyze Images

```http
POST /api/analyze
Content-Type: application/json

{
  "images": [
    {
      "filename": "house1.jpg",
      "base64": "data:image/jpeg;base64,/9j/4AAQ...",
      "size": 1024000,
      "mimetype": "image/jpeg"
    }
  ]
}
```

You can also analyze a supported listing URL directly:

```json
{
  "url": "https://www.zillow.com/homedetails/example",
  "maxImages": 8
}
```

### Upload and Analyze (One Request)

```http
POST /api/upload-and-analyze
Content-Type: multipart/form-data

# Form data:
images: [file1, file2, ...] (max 5 files, 10MB each)
```

## 📊 Response Format

```json
{
  "success": true,
  "analysis": {
    "overall_score": 85,
    "analyzed_images": 2,
    "accessibility_features": [
      "Wide doorway (36 inches)",
      "Good lighting in hallway",
      "Accessible bathroom layout"
    ],
    "barriers": ["Step at entrance without ramp", "Narrow hallway (28 inches)"],
    "recommendations": [
      "Install ramp at entrance",
      "Widen hallway to 36 inches",
      "Add grab bars in bathroom"
    ],
    "detailed_results": [
      {
        "filename": "house1.jpg",
        "vision": {
          "score": 85,
          "analysis": {
            "accessibility_features": ["Wide doorway (36 inches)"],
            "barriers": ["Step at entrance without ramp"],
            "recommendations": ["Install ramp at entrance"],
            "confidence": 0.9
          }
        }
      }
    ]
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Request Tracing

Every response includes an `X-HackMarket-Request-Id` header. Error responses also
include the same `requestId` in the JSON body so client logs can be correlated
with server logs quickly.

Rate-limited responses also include a standard `Retry-After` header in seconds.

### Error Format

```json
{
  "error": "Invalid request",
  "message": "Optional user-facing explanation",
  "details": [],
  "requestId": "req_123"
}
```

## 🛠️ Development

### Scripts

```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests
npm run lint       # Run ESLint
npm run format:check # Check formatting with Prettier
npm run format     # Format code with Prettier
npm run verify     # Run format, lint, and tests together
```

### Environment Variables

| Variable                        | Default               | Description                                                                       |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `PORT`                          | 3000                  | Server port                                                                       |
| `NODE_ENV`                      | development           | Environment                                                                       |
| `OPENROUTER_API_KEY`            | -                     | OpenRouter API key used by the vision + comprehensive analysis services           |
| `OPENROUTER_TIMEOUT_MS`         | 20000                 | Timeout for OpenRouter requests                                                   |
| `PUBLIC_APP_URL`                | https://hackmarket.io | Referer header sent to OpenRouter                                                 |
| `ALLOWED_ORIGINS`               | \*                    | Comma-separated allowed origins, or `*` to reflect any origin without credentials |
| `RATE_LIMIT_WINDOW_MS`          | 900000                | Rate limit window size in milliseconds                                            |
| `RATE_LIMIT_MAX_REQUESTS`       | 100                   | Rate limit per window                                                             |
| `ANALYSIS_TIMEOUT_MS`           | 45000                 | End-to-end timeout for a single analysis request                                  |
| `MAX_FILE_SIZE`                 | 10485760              | Max file size (10MB)                                                              |
| `MAX_FILES`                     | 5                     | Max files per request                                                             |
| `MAX_INLINE_IMAGES`             | 5                     | Max inline base64 images accepted by JSON analysis requests                       |
| `MAX_IMAGE_WIDTH`               | 2048                  | Max width after optimization                                                      |
| `MAX_IMAGE_HEIGHT`              | 2048                  | Max height after optimization                                                     |
| `IMAGE_QUALITY`                 | 85                    | JPEG optimization quality                                                         |
| `LISTING_FETCH_TIMEOUT_MS`      | 10000                 | Timeout for listing HTML fetches                                                  |
| `REMOTE_IMAGE_FETCH_TIMEOUT_MS` | 10000                 | Timeout for scraped image downloads                                               |
| `MAX_REMOTE_IMAGE_BYTES`        | 12582912              | Max remote image size in bytes                                                    |
| `TEMP_DIR`                      | ./tmp                 | Base temp directory                                                               |
| `UPLOAD_DIR`                    | ./tmp/uploads         | Upload temp directory                                                             |

## 🔧 Features

### ✅ **Fast Implementation**

- Single Express.js server
- Hackmarket-compatible root analysis endpoint (`POST /`)
- OpenRouter-based accessibility analysis
- Simple file upload handling
- Lazy service initialization so `/health` responds quickly after cold starts

### ✅ **Image Processing**

- Automatic image optimization
- Base64 conversion
- Format validation
- Size limits and compression
- Validation rules that stay aligned with env-driven upload limits

### ✅ **Security**

- Helmet.js security headers
- Explicit CORS allowlist support with wildcard fallback
- Rate limiting
- Input validation
- File type validation

### ✅ **Error Handling**

- Comprehensive error logging
- Graceful error responses
- Request validation
- File cleanup

### ✅ **Performance**

- Image optimization with Sharp
- Concurrent processing
- Memory-efficient base64 handling
- Temporary file cleanup
- Explicit timeouts for listing HTML and remote image fetches

## 🚀 Deployment Options

### Railway (Easiest)

1. Connect GitHub repo to Railway
2. Set `OPENROUTER_API_KEY` and `PUBLIC_APP_URL`
3. Deploy automatically

### Render

1. Connect GitHub repo to Render
2. Set environment variables in dashboard
3. Deploy automatically

### Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

### Heroku

```bash
# Install Heroku CLI
# Create Procfile: web: npm start
# Deploy
git push heroku main
```

## 📈 Performance

### Benchmarks

- **Image Processing**: ~2-3 seconds per image
- **LLM Analysis**: ~5-10 seconds per image
- **Total Response Time**: ~10-15 seconds for 2 images
- **Concurrent Requests**: 100 requests per 15 minutes

### Optimization Tips

- Use image optimization (automatic)
- Implement caching for repeated analyses
- Use CDN for static assets
- Monitor API usage and costs

## 🔍 Monitoring

### Health Check

```bash
curl https://your-api.com/health
```

### Local smoke test

```bash
npm run verify
```

### Logs

- Structured JSON logging
- Request/response logging
- Error tracking
- Performance metrics

## 🧪 Testing

### Manual Testing

```bash
# Test upload
curl -X POST -F "images=@test-image.jpg" http://localhost:3000/api/upload

# Test analysis
curl -X POST -H "Content-Type: application/json" \
  -d '{"images":[{"filename":"test.jpg","base64":"..."}]}' \
  http://localhost:3000/api/analyze
```

### Automated Testing

```bash
npm run verify
```

You can also run the individual checks when you only want one signal:

```bash
npm run format:check
npm run lint
npm test
```

## 🔧 Troubleshooting

### Common Issues

**OpenRouter API Key Error**

```bash
# Check your .env file
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

**File Upload Issues**

```bash
# Check file size and format
# Max 10MB, formats: jpg, png, webp
```

**Rate Limiting**

```bash
# Adjust rate limits in .env
RATE_LIMIT_MAX_REQUESTS=200
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev
```

## 📚 Next Steps

1. **Add Database**: Store analysis results
2. **Implement Caching**: Redis for repeated analyses
3. **Add Authentication**: User management
4. **Batch Processing**: Multiple image optimization
5. **WebSocket Support**: Real-time updates
6. **Admin Dashboard**: Analysis management

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details.

---

This service is optimized for quick iteration, strong local feedback, and predictable production behavior.
