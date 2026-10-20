const { Ollama } = require('ollama');
const { createServiceLogger } = require('../config/logger');

class LLMService {
    constructor() {
        this.logger = createServiceLogger('LLMService');
        this.ollama = new Ollama({
            host: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
        });
        this.model = process.env.OLLAMA_MODEL || 'llama2:7b';
        this.embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
        this.timeout = parseInt(process.env.OLLAMA_TIMEOUT) || 60000;
    }

    async generateEmbedding(text) {
        try {
            this.logger.debug(`Generating embedding for text: ${text.substring(0, 100)}...`);

            const response = await this.ollama.embeddings({
                model: this.embeddingModel,
                prompt: text
            });

            this.logger.debug(`Generated embedding with ${response.embedding.length} dimensions`);
            return response.embedding;
        } catch (error) {
            this.logger.error('Failed to generate embedding:', error);
            throw new Error(`Embedding generation failed: ${error.message}`);
        }
    }

    async generateTestCase(defectDetails) {
        try {
            this.logger.info(`Generating test case for defect: ${defectDetails.number}`);

            const prompt = this._createTestCaseGenerationPrompt(defectDetails);
            const startTime = Date.now();
            const response = await this.ollama.generate({
                model: this.model,
                system: 'You are an expert QA engineer creating test cases based on defect details. ONLY respond with valid JSON following the exact schema provided. Do not include any explanations or text outside the JSON object.',
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.2,
                    top_p: 0.6,
                    max_tokens: 2000
                }
            });

            const duration = (Date.now() - startTime) / 1000;
            const generatedTestCase = this._parseTestCaseResponse(response.response, defectDetails);

            this.logger.info(`Successfully generated test case: ${generatedTestCase.id} in ${duration}s`);
            return generatedTestCase;
        } catch (error) {
            this.logger.error('Failed to generate test case:', error);
            throw new Error(`Test case generation failed: ${error.message}`);
        }
    }

    async analyzeSimilarity(defectText, testCaseText) {
        try {
            const prompt = `
Analyze the similarity between the following defect and test case. Provide a similarity score from 0.0 to 1.0 and explain the reasoning.

DEFECT:
${defectText}

TEST CASE:
${testCaseText}

Please respond in the following JSON format:
{
  "similarity_score": Generate the similarity score between 0-1, based on the matching of the text content of DEFECT and TEST CASE,
  "reasoning": "Explanation of why they are similar or different"
}
`;

            const response = await this.ollama.generate({
                model: this.model,
                system: 'You are an expert QA engineer analyzing the similarity between a defect and a test case and generate a strongly structured JSON response.',
                prompt: prompt,
                stream: false,
                options: {
                    temperature: 0.3,
                    top_p: 0.7
                }
            });

            return this._parseSimilarityResponse(response.response);
        } catch (error) {
            this.logger.error('Failed to analyze similarity:', error);
            throw new Error(`Similarity analysis failed: ${error.message}`);
        }
    }

    _createTestCaseGenerationPrompt(defectDetails) {
        return `
You are an expert QA engineer tasked with creating a comprehensive test case based on a defect report.

DEFECT DETAILS:
Number: ${defectDetails.number}
Title: ${defectDetails['short_description']}
Description: ${defectDetails.description}
Engineer Details: ${defectDetails.engineering_details}
Steps to Reproduce: ${defectDetails.steps_to_reproduce}
Product Service: ${defectDetails.u_product_service.value}
Prerequisites: ${defectDetails.prereq}
Severity: ${defectDetails.severity}
Priority: ${defectDetails.priority}
Business Value: ${defectDetails.u_business_value}
Business Outcome: ${defectDetails.u_business_outcome}
Classification: ${defectDetails.classification}
Defect Type: ${defectDetails.defect_type}
Problem Type: ${defectDetails.u_problem_type.value}

Please create a detailed test case that would help reproduce and validate this defect. The test case should include:
1. Detailed description
2. prerequisites (if any)
3. Step-by-step test execution with expected results
4. Appropriate category and component
5. Relevant tags

Respond in the following JSON format:
{
  "prerequisites": "new line separated list of prerequisites",
  "steps": [
    {
      "step": "Action to perform",
      "expected_result": "What should happen"
    }
  ],
  "category": "functional|regression|integration|etc",
  "component": "Component being tested",
  "priority": "high|medium|low",
  "sys_tags": ["relevant", "tags"]
}

Ensure the test case is comprehensive and would effectively catch the defect described.
`;
    }

    _parseTestCaseResponse(response, defectDetails) {
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Generate ID and add metadata
            const testCaseId = `TC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

            return {
                id: testCaseId,
                number: "TNTC-NOT_CREATED",
                short_description: `${defectDetails.number} - ${defectDetails.short_description}`,
                prerequisites: parsed.prerequisites || "",
                product_service: defectDetails.u_product_service.value,
                product_category: defectDetails.u_product_category.value,
                peer_approval_status: 'not requested',
                steps: parsed.steps || [],
                assignment_group: defectDetails.assignment_group.value,
                supported_releases: defectDetails.u_target_version.value,
                facet: defectDetails.defect_type,
                priority: defectDetails.priority,
                sys_tags: [...(parsed.sys_tags || []), 'ai-generated', `defect-${defectDetails.number}`],
                sys_created_by: 'AI-System',
                sys_created_on: new Date().toISOString(),
                genai_generated: "true",
                automation_status: 'candidate'
            };
        } catch (error) {
            this.logger.error('Failed to parse test case response:', error);
            throw new Error(`Failed to parse generated test case: ${error.message}`);
        }
    }

    _parseSimilarityResponse(response) {
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return {
                    similarity_score: 0.5,
                    reasoning: 'Could not parse similarity analysis',
                };
            }

            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            this.logger.error('Failed to parse similarity response:', error);
            return {
                similarity_score: 0.5,
                reasoning: 'Error parsing similarity analysis',
            };
        }
    }

    async checkModelAvailability() {
        try {
            const models = await this.ollama.list();
            const availableModels = models.models.map(m => m.name);

            const hasMainModel = availableModels.includes(this.model);
            const hasEmbeddingModel = availableModels.includes(this.embeddingModel);

            this.logger.info(`Available models: ${availableModels.join(', ')}`);
            this.logger.info(`Main model (${this.model}) available: ${hasMainModel}`);
            this.logger.info(`Embedding model (${this.embeddingModel}) available: ${hasEmbeddingModel}`);

            return {
                available: hasMainModel && hasEmbeddingModel,
                mainModel: hasMainModel,
                embeddingModel: hasEmbeddingModel,
                availableModels
            };
        } catch (error) {
            this.logger.error('Failed to check model availability:', error);
            throw error;
        }
    }
}

module.exports = LLMService;
