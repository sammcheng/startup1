/**
 * OpenAI Service for Accessibility Analysis
 * Uses GPT-4 Vision API for image analysis
 */

const OpenAI = require('openai');
const winston = require('winston');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console()
      ]
    });
  }

  async analyzeAccessibility(base64Image, filename) {
    try {
      this.logger.info('Starting accessibility analysis', { filename });

      const prompt = this.createAccessibilityPrompt();
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      });

      const analysisText = response.choices[0].message.content;
      const structuredResult = this.parseAnalysisResponse(analysisText, filename);

      this.logger.info('Analysis completed', { 
        filename, 
        score: structuredResult.score 
      });

      return structuredResult;

    } catch (error) {
      this.logger.error('OpenAI analysis failed', { 
        filename, 
        error: error.message 
      });
      throw new Error(`Analysis failed: ${error.message}`);
    }
  }

  createAccessibilityPrompt() {
    return `You are an accessibility expert analyzing a home environment image. Please provide a comprehensive accessibility assessment.

Analyze the image for:

1. **Accessibility Features** (positive elements):
   - Ramps and accessible entrances
   - Wide doorways and hallways
   - Grab bars and handrails
   - Accessible bathroom features
   - Good lighting and contrast
   - Clear pathways
   - Accessible kitchen features
   - Emergency accessibility features

2. **Potential Barriers** (negative elements):
   - Steps without ramps
   - Narrow doorways or hallways
   - High thresholds
   - Poor lighting
   - Cluttered pathways
   - Inaccessible bathroom features
   - Lack of grab bars
   - Poor contrast or visibility

3. **Safety Concerns**:
   - Trip hazards
   - Slippery surfaces
   - Poor lighting
   - Emergency egress issues

Please respond with a JSON object in this exact format:
{
  "score": 85,
  "positive_features": [
    "Wide doorway (36 inches)",
    "Good lighting in hallway",
    "Accessible bathroom layout"
  ],
  "barriers": [
    "Step at entrance without ramp",
    "Narrow hallway (28 inches)"
  ],
  "safety_concerns": [
    "Loose carpet edge",
    "Poor lighting in bedroom"
  ],
  "recommendations": [
    "Install ramp at entrance",
    "Widen hallway to 36 inches",
    "Add grab bars in bathroom",
    "Improve lighting in bedroom"
  ],
  "accessibility_rating": "Good",
  "priority_improvements": [
    "Install entrance ramp",
    "Widen hallway"
  ]
}

Provide specific, actionable recommendations. Focus on universal design principles and ADA compliance. Be detailed but concise.`;
  }

  parseAnalysisResponse(analysisText, filename) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        
        return {
          filename,
          score: parsed.score || 0,
          positive_features: parsed.positive_features || [],
          barriers: parsed.barriers || [],
          safety_concerns: parsed.safety_concerns || [],
          recommendations: parsed.recommendations || [],
          accessibility_rating: parsed.accessibility_rating || 'Unknown',
          priority_improvements: parsed.priority_improvements || [],
          raw_analysis: analysisText
        };
      } else {
        // Fallback parsing if JSON extraction fails
        return this.fallbackParsing(analysisText, filename);
      }
    } catch (error) {
      this.logger.warn('JSON parsing failed, using fallback', { 
        filename, 
        error: error.message 
      });
      return this.fallbackParsing(analysisText, filename);
    }
  }

  fallbackParsing(analysisText, filename) {
    // Extract score from text
    const scoreMatch = analysisText.match(/score[:\s]*(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;

    // Extract features and barriers using keyword matching
    const positiveFeatures = this.extractItems(analysisText, [
      'ramp', 'wide', 'accessible', 'grab bar', 'handrail', 'good lighting',
      'clear pathway', 'accessible bathroom', 'accessible kitchen'
    ]);

    const barriers = this.extractItems(analysisText, [
      'step', 'narrow', 'threshold', 'poor lighting', 'cluttered',
      'inaccessible', 'trip hazard', 'slippery'
    ]);

    const recommendations = this.extractItems(analysisText, [
      'install', 'add', 'improve', 'widen', 'remove', 'fix'
    ]);

    return {
      filename,
      score,
      positive_features: positiveFeatures,
      barriers: barriers,
      safety_concerns: [],
      recommendations: recommendations,
      accessibility_rating: this.getRatingFromScore(score),
      priority_improvements: recommendations.slice(0, 3),
      raw_analysis: analysisText
    };
  }

  extractItems(text, keywords) {
    const items = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      for (const keyword of keywords) {
        if (lowerLine.includes(keyword.toLowerCase())) {
          const cleanLine = line.replace(/^[-•*]\s*/, '').trim();
          if (cleanLine && !items.includes(cleanLine)) {
            items.push(cleanLine);
          }
        }
      }
    }
    
    return items.slice(0, 5); // Limit to 5 items
  }

  getRatingFromScore(score) {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'Good';
    if (score >= 70) return 'Fair';
    if (score >= 60) return 'Poor';
    return 'Very Poor';
  }

  async getDetailedRecommendations(base64Image, specificArea) {
    try {
      const prompt = `Focus on ${specificArea} accessibility in this home image. Provide specific, actionable recommendations for improving accessibility in this area. Include cost estimates and implementation difficulty.`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 1500,
        temperature: 0.3
      });

      return response.choices[0].message.content;

    } catch (error) {
      this.logger.error('Detailed recommendations failed', { 
        area: specificArea, 
        error: error.message 
      });
      throw new Error(`Failed to get detailed recommendations: ${error.message}`);
    }
  }
}

module.exports = OpenAIService;
