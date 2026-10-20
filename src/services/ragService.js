const VectorDbService = require('./vectorDbService');
const LLMService = require('./llmService');
const ExternalApiService = require('./externalApiService');
const { createServiceLogger } = require('../config/logger');
const { v4: uuidv4 } = require('uuid');
const { normalizeEmbedding } = require('../utils/embedding');

class RAGService {
    constructor() {
        this.logger = createServiceLogger('RAGService');
        this.vectorDb = new VectorDbService();
        this.llm = new LLMService();
        this.externalApi = new ExternalApiService();
        this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.7;
    }

    async initialize() {
        try {
            this.logger.info('Initializing RAG service...');
            await this.vectorDb.initialize();
            this.logger.info('RAG service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize RAG service:', error);
            throw error;
        }
    }

    async findSimilarTestCases(defectDetails, topK = 3) {
        try {
            this.logger.info(`Finding similar test cases for defect: ${defectDetails.number}`);

            // Create search text from defect details
            const searchText = this._createDefectSearchText(defectDetails);

            // Generate embedding for the defect
            const defectEmbedding = await this.llm.generateEmbedding(searchText);

            const normalizedEmbedding = normalizeEmbedding(defectEmbedding);

            // Search for similar test cases in vector DB
            const similarTestCases = await this.vectorDb.searchSimilarTestCases(
                normalizedEmbedding,
                topK * 2, // Get more results to filter
                this.similarityThreshold
            );

            // If we don't have enough similar test cases, search external API
            // if (similarTestCases.length < topK) {
            //     await this._fetchAndStoreAdditionalTestCases(defectDetails, topK - similarTestCases.length);

            //     // Search again after adding new test cases
            //     const updatedResults = await this.vectorDb.searchSimilarTestCases(
            //         defectEmbedding,
            //         topK,
            //         this.similarityThreshold
            //     );

            //     similarTestCases.push(...updatedResults.filter(tc =>
            //         !similarTestCases.some(existing => existing.id === tc.id)
            //     ));
            // }

            // Enhance results with detailed analysis
            const enhancedResults = await this._enhanceTestCaseResults(
                defectDetails,
                similarTestCases.slice(0, topK)
            );

            this.logger.info(`Found ${enhancedResults.length} similar test cases for defect ${defectDetails.number}`);
            return enhancedResults;

        } catch (error) {
            this.logger.error(`Failed to find similar test cases for defect ${defectDetails.number}:`, error);
            throw error;
        }
    }

    async generateTestCaseForDefect(defectDetails) {
        try {
            this.logger.info(`Generating new test case for defect: ${defectDetails.number}`);

            // Generate test case using LLM
            const generatedTestCase = await this.llm.generateTestCase(defectDetails);

            // Create embedding for the generated test case
            const testCaseText = this._createTestCaseSearchText(generatedTestCase);
            const embedding = await this.llm.generateEmbedding(testCaseText);

            // Store in vector database
            await this.vectorDb.addTestCase(generatedTestCase, embedding);

            this.logger.info(`Generated and stored test case: ${generatedTestCase.id}`);
            return {
                testCase: generatedTestCase,
                similarity: 1.0, // Perfect match since it's generated for this defect
                confidence: 'high',
                isGenerated: true
            };

        } catch (error) {
            this.logger.error(`Failed to generate test case for defect ${defectDetails.id}:`, error);
            throw error;
        }
    }

    async createDefectTestCaseMapping(defectId, testCaseId) {
        try {
            this.logger.info(`Creating mapping between defect ${defectId} and test case ${testCaseId}`);

            // Create mapping in external system
            const mapping = await this.externalApi.createDefectTestCaseMapping(
                defectId,
                testCaseId
            );

            return mapping;
        } catch (error) {
            this.logger.error(`Failed to create mapping between ${defectId} and ${testCaseId}:`, error);
            throw error;
        }
    }

    async generateAndCreateRCA(defectDetails, testCaseDetails = null) {
        try {
            this.logger.info(`Generating RCA for defect: ${defectDetails.number}`);

            // Create RCA in external system
            const rca = await this.externalApi.createRCA(defectDetails);

            this.logger.info(`Successfully created RCA: ${rca.u_number}`);
            return rca;

        } catch (error) {
            this.logger.error(`Failed to generate RCA for defect ${defectDetails.number}:`, error);
            throw error;
        }
    }

    async _fetchAndStoreAdditionalTestCases(defectDetails, count) {
        try {
            this.logger.info(`Fetching additional test cases from external API for defect: ${defectDetails.id}`);

            // Create search criteria based on defect details
            const searchCriteria = {
                component: defectDetails.productSpecification?.product,
                limit: count * 2 // Get more to have options
            };

            // Search external API
            const searchResults = await this.externalApi.searchTestCases(searchCriteria);

            if (searchResults.testCases && searchResults.testCases.length > 0) {
                // Generate embeddings and store new test cases
                const testCasesWithEmbeddings = [];

                for (const testCase of searchResults.testCases.slice(0, count)) {
                    const searchText = this._createTestCaseSearchText(testCase);
                    const embedding = await this.llm.generateEmbedding(searchText);
                    testCasesWithEmbeddings.push({ testCase, embedding });
                }

                await this.vectorDb.addTestCasesBatch(testCasesWithEmbeddings);
                this.logger.info(`Fetched and stored ${testCasesWithEmbeddings.length} additional test cases`);
            }

        } catch (error) {
            this.logger.warn('Failed to fetch additional test cases from external API:', error);
            // Don't throw error as this is supplementary functionality
        }
    }

    async _enhanceTestCaseResults(defectDetails, testCases) {
        const enhancedResults = [];

        for (const testCase of testCases) {
            try {
                // Get detailed similarity analysis from LLM
                const defectText = this._createDefectSearchText(defectDetails);
                const testCaseText = this._createTestCaseSearchText(testCase);

                const similarityAnalysis = await this.llm.analyzeSimilarity(defectText, testCaseText);
                similarityAnalysis.confidence = this._calculateConfidence(testCase.similarity, similarityAnalysis);
                similarityAnalysis.recommendation = this._generateRecommendation(testCase.similarity);
                
                // Add similarity score to test case
                similarityAnalysis.similarity_score = testCase.similarity;
                delete testCase.similarity;
                enhancedResults.push({
                    ...testCase,
                    similarityAnalysis
                });

            } catch (error) {
                this.logger.warn(`Failed to enhance test case ${testCase.id}:`, error);
                // Include basic result without enhancement
                enhancedResults.push({
                    ...testCase,
                    similarityAnalysis: {
                        similarity_score: testCase.similarity,
                        confidence: testCase.similarity > 0.8 ? 'high' : testCase.similarity > 0.6 ? 'medium' : 'low'
                    }
                });
                delete testCase.similarity;
            }
        }

        return enhancedResults;
    }

    _createDefectSearchText(defectDetails) {
        // Build a comprehensive search text for vector similarity matching
        // Using the same format as _createTestCaseSearchText for consistent embedding
        const parts = [
            `Title: ${defectDetails.short_description || ''}`,
            `Component: ${defectDetails.u_product_service?.value || ''}`,
            `Category: ${defectDetails.u_product_category?.value || ''}`,
            `Problem Type: ${defectDetails.u_problem_type || ''}`
        ];

        if (defectDetails.prereq && defectDetails.prereq.length > 0) {
            // Handle both string and array types for preconditions
            const preconditionsText = Array.isArray(defectDetails.prereq)
                ? defectDetails.prereq.join('; ')
                : defectDetails.prereq;
            parts.push(`Prerequisites: ${preconditionsText}`);
        }

        // Steps to reproduce - similar to test case steps
        if (defectDetails.steps_to_reproduce) {
            parts.push(`Steps to reproduce: ${defectDetails.steps_to_reproduce}`);
        }

        // Important: Use same join format as test cases
        return parts.join('\n');
    }

    _createTestCaseSearchText(testCase) {
        const parts = [
            `Title: ${testCase.short_description}`,
            `Component: ${testCase.product_service}`,
            `Category: ${testCase.product_category}`,
            `Problem Type: ${testCase.facet}`
        ];

        if (testCase.prerequisites && testCase.prerequisites.length > 0) {
               // Handle both string and array types for preconditions
            const preconditionsText = Array.isArray(testCase.prerequisites)
                ? testCase.prerequisites.join('; ')
                : testCase.prerequisites;
            parts.push(`Prerequisites: ${preconditionsText}`);
        }

        if (testCase.steps && testCase.steps.length > 0) {
            const steps = testCase.steps.map((step, index) =>
                typeof step === 'string' ? `${index+1}. ${step}` : `${index+1}. ${step.step}`
            ).join('\r\n');
            parts.push(`Steps to reproduce: ${steps}`);
        }
        
        return parts.join('\n');
    }

    _parseTestSteps(stepsString) {
        try {
            // Parse test steps from string format
            // Expected format: "Step 1: Action - Expected: Result; Step 2: Action - Expected: Result"
            return stepsString.split(';').map(stepStr => {
                const parts = stepStr.split(' - Expected: ');
                return {
                    step: parts[0]?.replace(/^Step \d+: /, '').trim(),
                    expectedResult: parts[1]?.trim() || ''
                };
            }).filter(step => step.step);
        } catch (error) {
            return [];
        }
    }

    _calculateConfidence(similarity, analysis) {
        if (similarity > 0.85 && analysis.similarity_score > 0.8) {
            return 'high';
        } else if (similarity > 0.7 && analysis.similarity_score > 0.6) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    _generateRecommendation(similarity) {
        if (similarity > 0.85) {
            return 'Highly recommended - Strong similarity detected';
        } else if (similarity > 0.7) {
            return 'Recommended - Good similarity with some differences';
        } else {
            return 'Consider with caution - Low similarity score';
        }
    }

    _parseHtmlSteps(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') {
            return [];
        }

        try {
            // Remove HTML tags but preserve content
            const cleanText = htmlContent
                .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
                .replace(/&nbsp;/g, ' ')   // Replace &nbsp; with spaces
                .replace(/\s+/g, ' ')      // Normalize whitespace
                .trim();

            // Try to extract meaningful steps from the cleaned text
            const steps = [];
            
            // Look for numbered steps or structured content
            const lines = cleanText.split(/\s+/);
            let currentStep = '';
            let stepNumber = 1;
            
            for (let i = 0; i < lines.length; i++) {
                const word = lines[i].trim();
                
                // Check if this looks like a step indicator
                if (word === stepNumber.toString() || word === `${stepNumber}.`) {
                    // Save previous step if exists
                    if (currentStep.trim()) {
                        steps.push({
                            step: currentStep.trim(),
                            expectedResult: '' // Will be extracted separately if available
                        });
                    }
                    
                    // Start new step
                    currentStep = '';
                    stepNumber++;
                    continue;
                }
                
                // Add word to current step
                currentStep += word + ' ';
            }
            
            // Add the last step
            if (currentStep.trim()) {
                steps.push({
                    step: currentStep.trim(),
                    expectedResult: ''
                });
            }
            
            // If no structured steps found, create a single step from the entire content
            if (steps.length === 0 && cleanText.length > 0) {
                steps.push({
                    step: cleanText,
                    expectedResult: ''
                });
            }
            
            return steps;
            
        } catch (error) {
            this.logger.warn('Failed to parse HTML steps:', error);
            // Return a single step with the raw content as fallback
            return [{
                step: htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
                expectedResult: ''
            }];
        }
    }

    async storeTestCase(testCaseData) {
        try {
            this.logger.debug(`Storing test case: ${testCaseData.sys_id}`);

            if (!this.vectorDb.isInitialized) {
                await this.vectorDb.initialize();
            }

            // Create standardized test case object from actual vendor API response structure
            const testCase = {
                id: testCaseData.sys_id,
                number: testCaseData.number,
                short_description: testCaseData.short_description,
                prerequisites: testCaseData.prerequisites,
                product_service: testCaseData.product_service?.value || '',
                product_category: testCaseData.product_category?.value || '',
                peer_approval_status: testCaseData.peer_approval_status,
                steps: this._parseHtmlSteps(testCaseData.steps),
                assignment_group: testCaseData.assignment_group?.value || '',
                supported_releases: testCaseData.u_target_version?.value || '',
                facet: testCaseData.facet,
                priority: testCaseData.priority,
                sys_tags: testCaseData.sys_tags,
                sys_created_by: testCaseData.sys_created_by,
                sys_created_on: testCaseData.sys_created_on,
                genai_generated: testCaseData.genai_generated,
                automation_status: testCaseData.automation_status,
            }

            // Create search text for embedding generation
            const searchText = this._createTestCaseSearchText(testCase);
            
            // Generate embedding for the test case
            const embedding = await this.llm.generateEmbedding(searchText);
            
            // Store the test case in vector database
            const storedId = await this.vectorDb.addTestCase(testCase, embedding);
            
            this.logger.info(`Successfully stored test case: ${testCase.id}`);
            return storedId;

        } catch (error) {
            this.logger.error(`Failed to store test case ${testCaseData.sys_id}:`, error);
            throw error;
        }
    }

    async getTestCaseById(testCaseId) {
        try {
            this.logger.info(`Retrieving test case from vector DB by ID: ${testCaseId}`);
            const testCase = await this.vectorDb.getTestCaseById(testCaseId, false);
            testCase.steps = this._convertStepsToTableUI(testCase.steps);
            return testCase;
        } catch (error) {
            this.logger.error(`Failed to get test case from vector DB by ID: ${testCaseId}:`, error);
            throw error;
        }
    }

    async updateTestCaseId(oldTestCaseId, testCase) {
        try {
            this.logger.info(`Updating test case ID in vector DB: ${oldTestCaseId} → ${testCase.id}`);
            await this.vectorDb.updateTestCaseId(oldTestCaseId, testCase);
            return testCase.id;
        } catch (error) {
            this.logger.error(`Failed to update test case ID in vector DB: ${oldTestCaseId} → ${testCase.id}:`, error);
            throw error;
        }
    }

    _convertStepsToTableUI(steps) {
        if (!steps || steps.length === 0) {
            return "";
        }
        
        let tableHTML = `
        <table style="width: 100%;" border="1" cellspacing="0" cellpadding="0">
        <tbody>
        <tr style="background-color: rgb(20, 161, 222); height: 40.6562px;">
            <td style="width: 2.40302%; text-align: center; height: 40.6562px;"><span style="font-size: 10pt;"><strong>Order</strong></span></td>
            <td style="width: 45.1811%; text-align: center; height: 40.6562px;"><span style="font-size: 10pt;"><strong>Step</strong></span></td>
            <td style="width: 38.3784%; height: 40.6562px; text-align: center;"><span style="font-size: 10pt;"><strong>Expected Result</strong></span></td>
            <td style="width: 14.0904%; height: 40.6562px;">
                <p style="text-align: center;"><span style="font-size: 10pt;"><strong>Automation Status</strong></span></p>
            </td>
        </tr>
        `;
        
        // Process each step and add it to the table
        steps.forEach((stepObj, index) => {
            // Handle both object format and string format
            let stepContent = '';
            let expectedResult = '';
            
            if (typeof stepObj === 'object') {
                stepContent = stepObj.step || stepObj.action || '';
                expectedResult = stepObj.expected_result || stepObj.expectedResult || '';
            } else if (typeof stepObj === 'string') {
                stepContent = stepObj;
            }
            
            tableHTML += `
            <tr style="height: 200.719px;">
                <td style="width: 2.40302%; text-align: center; height: 200.719px;">
                    <p>${index + 1}</p>
                </td>
                <td style="width: 45.1811%; height: 200.719px;">
                    ${stepContent}
                </td>
                <td style="width: 38.3784%; height: 200.719px;">
                    ${expectedResult}
                </td>
                <td style="width: 14.0904%; height: 200.719px;">
                    <p style="text-align: center;">Candidate</p>
                </td>
            </tr>
            `;
        });
        
        // Close the table
        tableHTML += `
        </tbody>
        </table>
        `;
        
        return tableHTML;
    }
}

module.exports = RAGService;
