const RAGService = require('../services/ragService');
const ExternalApiService = require('../services/externalApiService');
const { createServiceLogger } = require('../config/logger');
const Joi = require('joi');

class DefectController {
    constructor() {
        this.logger = createServiceLogger('DefectController');
        this.ragService = new RAGService();
        this.externalApi = new ExternalApiService();
        this.isInitialized = false;
    }

    async initialize() {
        if (!this.isInitialized) {
            await this.ragService.initialize();
            this.isInitialized = true;
            this.logger.info('DefectController initialized');
        }
    }

    // API 1: Analyze defect and find/generate matching test cases
    async analyzeDefect(req, res) {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;

        try {
            await this.initialize();

            this.logger.info(`[${requestId}] Starting defect analysis`, {
                defectNumber: req.params.defectNumber
            });

            const { defectNumber } = req.params;

            // Step 1: Fetch defect details from external API
            this.logger.info(`[${requestId}] Fetching defect details for: ${defectNumber}`);
            let defectDetails, defectDisplayValues;

            try {
                defectDetails = await this.externalApi.getDefectDetails(defectNumber, false);
                defectDisplayValues = await this.externalApi.getDefectDetails(defectNumber, true);
            } catch (error) {
                this.logger.error(`[${requestId}] Failed to fetch defect details:`, error);
                return res.status(404).json({
                    success: false,
                    error: 'Defect not found or external API unavailable',
                    message: error.message,
                    requestId
                });
            }

            // Step 2: Check for existing test case mappings in external API
            this.logger.info(`[${requestId}] Checking for existing test case mappings`);
            let existingMappings = [];
            
            try {
                existingMappings = await this.externalApi.getDefectTestCaseMappings(defectDetails.sys_id, defectDetails.number);
                
                if (existingMappings && existingMappings.length > 0) {
                    this.logger.info(`[${requestId}] Found ${existingMappings.length} existing mappings`);
                    
                    // Fetch details for each mapped test case
                    const mappedTestCases = [];
                    for (const mapping of existingMappings) {
                        try {
                            const testCaseDetails = await this.externalApi.getTestCaseDetails(mapping.test_case);
                            mappedTestCases.push({
                                ...testCaseDetails,
                                mappingSysId: mapping.sys_id
                            });
                        } catch (error) {
                            this.logger.warn(`[${requestId}] Could not fetch details for mapped test case ${mapping.test_case}`);
                        }
                    }
                    
                    if (mappedTestCases.length > 0) {
                        return res.json({
                            success: true,
                            defect: defectDisplayValues,
                            matchType: 'MAPPED',
                            testCases: mappedTestCases,
                            processingTime: Date.now() - startTime,
                            requestId
                        });
                    }
                }
                this.logger.info(`[${requestId}] No existing mappings found or failed to fetch mapped test cases`);
            } catch (error) {
                this.logger.warn(`[${requestId}] Error checking for existing mappings:`, error);
                // Continue with RAG search if mapping check fails
            }
            
            // Step 3: Find similar test cases using RAG with higher similarity threshold
            this.logger.info(`[${requestId}] Searching for similar test cases with similarity threshold: ${process.env.SIMILARITY_THRESHOLD}`);
            
            const similarTestCases = await this.ragService.findSimilarTestCases(defectDetails, 3);

            let result;

            if (similarTestCases.length > 0) {
                // Found similar test cases
                this.logger.info(`[${requestId}] Found ${similarTestCases.length} similar test cases`);

                // Fetch display values for test cases
                const testCaseDisplayValues = await this.externalApi.getTestCaseListDetails(similarTestCases);

                result = {
                    success: true,
                    defect: defectDisplayValues,
                    matchType: 'EXISTING',
                    testCases: testCaseDisplayValues,
                    processingTime: Date.now() - startTime,
                    requestId
                };
            } else {
                // No similar test cases found, generate new one
                this.logger.info(`[${requestId}] No similar test cases found, generating new test case`);

                const generatedTestCase = await this.ragService.generateTestCaseForDefect(defectDetails);

                result = {
                    success: true,
                    defect: defectDisplayValues,
                    matchType: 'GENERATED',
                    testCases: [generatedTestCase],
                    processingTime: Date.now() - startTime,
                    requestId
                };
            }

            this.logger.info(`[${requestId}] Defect analysis completed successfully`, {
                matchType: result.matchType,
                testCasesCount: result.testCases.length,
                processingTime: result.processingTime
            });

            res.json(result);

        } catch (error) {
            this.logger.error(`[${requestId}] Defect analysis failed:`, error);
            res.status(500).json({
                success: false,
                error: 'Internal server error during defect analysis',
                message: error.message,
                requestId,
                processingTime: Date.now() - startTime
            });
        }
    }

    // API 2: Create mapping between defect and test case, and generate RCA
    async createMapping(req, res) {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] || `req-${Date.now()}`;

        try {
            await this.initialize();

            this.logger.info(`[${requestId}] Starting mapping creation`, {
                defectNumber: req.params.defectNumber,
                testCaseId: req.params.testCaseId
            });

            const { defectNumber, testCaseId } = req.params;

            // Step 1: Get defect details
            this.logger.info(`[${requestId}] Fetching defect details for mapping`);
            let defectDetails, defectDisplayValues;

            try {
                defectDetails = await this.externalApi.getDefectDetails(defectNumber, false);
                defectDisplayValues = await this.externalApi.getDefectDetails(defectNumber, true);
            } catch (error) {
                this.logger.error(`[${requestId}] Failed to fetch defect details:`, error);
                return res.status(404).json({
                    success: false,
                    error: 'Defect not found',
                    message: error.message,
                    requestId
                });
            }

            // Step 2: Get test case details (if it exists in external system)
            let testCaseDetails = null;
            try {
                testCaseDetails = await this.externalApi.getTestCaseDetails(testCaseId);
                this.logger.info(`[${requestId}] Found existing test case: ${testCaseId}`);
            } catch (error) {
                this.logger.info(`[${requestId}] Test case not found in external system, might be AI-generated`);
            }

            // Step 3: If test case doesn't exist in external system, create it
            if (!testCaseDetails) {
                this.logger.info(`[${requestId}] Creating test case in external system`);

                // This assumes the test case was generated and we need to create it
                try {
                    const testCaseToCreate = await this.ragService.getTestCaseById(testCaseId);
                    testCaseDetails = await this.externalApi.createTestCase(testCaseToCreate, testCaseId);
                    this.logger.info(`[${requestId}] Successfully created test case: ${testCaseDetails.sys_id}`);

                    await this.ragService.updateTestCaseId(testCaseId, testCaseDetails);
                    this.logger.info(`[${requestId}] Successfully updated test case ID in vector DB: ${testCaseId} → ${testCaseDetails.sys_id}`);
                } catch (createError) {
                    this.logger.error(`[${requestId}] Failed to create test case:`, createError);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create test case in external system',
                        message: createError.message,
                        requestId
                    });
                }
            }

            // Step 4: Create mapping between defect and test case
            this.logger.info(`[${requestId}] Creating defect-testcase mapping`);

            const mapping = await this.ragService.createDefectTestCaseMapping(
                defectDetails.sys_id,
                testCaseDetails.sys_id
            );

            // Step 5: Generate and create RCA
            this.logger.info(`[${requestId}] Generating RCA`);
            const rcaResult = await this.ragService.generateAndCreateRCA(defectDetails, testCaseDetails);

            // Step 6: Update defect with RCA
            this.logger.info(`[${requestId}] Updating defect with RCA`);
            await this.externalApi.updateDefectWithRCAs(defectDetails.sys_id, rcaResult.sys_id);

            const result = {
                success: true,
                defect: defectDisplayValues,
                testCase: testCaseDetails,
                mapping,
                rca: rcaResult,
                processingTime: Date.now() - startTime,
                requestId
            };

            this.logger.info(`[${requestId}] Mapping creation completed successfully`, {
                mappingId: mapping.id,
                rcaId: rcaResult.sys_id,
                processingTime: result.processingTime
            });

            res.json(result);

        } catch (error) {
            this.logger.error(`[${requestId}] Mapping creation failed:`, error);
            res.status(500).json({
                success: false,
                error: 'Internal server error during mapping creation',
                message: error.message,
                requestId,
                processingTime: Date.now() - startTime
            });
        }
    }

    // Health check endpoint
    async healthCheck(req, res) {
        try {
            const [externalApiHealth, vectorDbStats] = await Promise.all([
                this.externalApi.healthCheck(),
                this.ragService.vectorDb.getCollectionStats().catch(() => ({ error: 'VectorDB unavailable' }))
            ]);

            const health = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                services: {
                    externalApi: externalApiHealth,
                    vectorDb: vectorDbStats.error ? 'down' : 'up',
                    vectorDbStats: vectorDbStats.error ? null : vectorDbStats
                }
            };

            res.json(health);
        } catch (error) {
            this.logger.error('Health check failed:', error);
            res.status(503).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = DefectController;
