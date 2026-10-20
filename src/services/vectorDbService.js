const { ChromaClient } = require('chromadb');
const { createServiceLogger } = require('../config/logger');
const { v4: uuidv4 } = require('uuid');
const { normalizeEmbedding } = require('../utils/embedding');

class VectorDbService {
    constructor() {
        this.logger = createServiceLogger('VectorDbService');
        this.client = null;
        this.collection = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info('Initializing ChromaDB connection...');

            this.client = new ChromaClient({
                path: `http://${process.env.CHROMA_HOST}:${process.env.CHROMA_PORT}`
            });

            // Create or get collection for test cases
            const collectionName = process.env.CHROMA_COLLECTION_NAME || 'defect_test_case_rca';

            try {
                this.collection = await this.client.getCollection({
                    name: collectionName
                });
                this.logger.info(`Connected to existing collection: ${collectionName}`);
            } catch (error) {
                // Collection doesn't exist, create it
                this.collection = await this.client.createCollection({
                    name: collectionName,
                    metadata: {
                        description: 'Test cases for defect automation system',
                        created_at: new Date().toISOString()
                    },
                    embeddingFunction: 'cosine'
                });
                this.logger.info(`Created new collection: ${collectionName}`);
            }

            this.isInitialized = true;
            this.logger.info('VectorDB service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize VectorDB service:', error);
            throw error;
        }
    }

    async addTestCase(testCase, embedding) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const id = testCase.sys_id || testCase.id || uuidv4();
            const document = this._createTestCaseDocument(testCase);
            const normalizedEmbedding = normalizeEmbedding(embedding);
            await this.collection.add({
                ids: [id],
                embeddings: [normalizedEmbedding],
                documents: [document],
                metadatas: [{
                    id: id,
                    number: testCase.number,
                    title: testCase.short_description,
                    category: testCase.product_category,
                    component: testCase.product_service,
                    priority: testCase.priority,
                    prerequisites: testCase.prerequisites,
                    assignment_group: testCase.assignment_group,
                    facet: testCase.facet,
                    steps: JSON.stringify(testCase.steps),
                    sys_created_on: testCase.sys_created_on,
                    sys_created_by: testCase.sys_created_by,
                    genai_generated: testCase.genai_generated || "false",
                    automation_status: testCase.automation_status,
                    sys_tags: JSON.stringify(testCase.sys_tags || [])
                }]
            });

            this.logger.info(`Added test case to vector DB: ${testCase.id}`);
            return id;
        } catch (error) {
            this.logger.error(`Failed to add test case ${testCase.id}:`, error);
            throw error;
        }
    }

    async addTestCasesBatch(testCasesWithEmbeddings) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const batchSize = parseInt(process.env.BATCH_SIZE) || 100;
            const batches = this._createBatches(testCasesWithEmbeddings, batchSize);

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const ids = batch.map(item => item.testCase.sys_id || item.testCase.id || uuidv4());
                const embeddings = batch.map(item => normalizeEmbedding(item.embedding));
                const documents = batch.map(item => this._createTestCaseDocument(item.testCase));
                const metadatas = batch.map(item => ({
                    id: item.testCase.id,
                    title: item.testCase.title,
                    category: item.testCase.category,
                    component: item.testCase.component,
                    priority: item.testCase.priority,
                    created_at: item.testCase.createdAt || new Date().toISOString(),
                    genai_generated: item.testCase.genai_generated || "false"
                }));

                await this.collection.add({
                    ids,
                    embeddings,
                    documents,
                    metadatas
                });

                this.logger.info(`Added batch ${i + 1}/${batches.length} (${batch.length} test cases)`);
            }

            this.logger.info(`Successfully added ${testCasesWithEmbeddings.length} test cases to vector DB`);
        } catch (error) {
            this.logger.error('Failed to add test cases batch:', error);
            throw error;
        }
    }

    async searchSimilarTestCases(queryEmbedding, nResults = 10, threshold = null) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const searchThreshold = threshold || parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.7;
            const maxResults = Math.min(nResults, parseInt(process.env.MAX_SIMILAR_RESULTS) || 10);

            const startTime = Date.now();            
            const results = await this.collection.query({
                queryEmbeddings: [queryEmbedding],
                nResults: maxResults,
                include: ['documents', 'metadatas', 'distances']
            });
            const searchTime = Date.now() - startTime;
            this.logger.info(`ChromaDB similarity search query completed in ${searchTime}ms`);

            // Filter by similarity threshold and format results
            const similarTestCases = [];

            if (results.distances && results.distances[0]) {
                for (let i = 0; i < results.distances[0].length; i++) {
                    const distance = results.distances[0][i];
                    const similarity = 1 - distance; // Convert distance to similarity

                    if (similarity >= searchThreshold) {
                        const testCase = results.metadatas[0][i];
                        similarTestCases.push({
                            sys_id: testCase.id,
                            number: testCase.number,
                            short_description: testCase.title,
                            prerequisites: testCase.prerequisites,
                            product_service: testCase.component,
                            product_category: testCase.category,
                            steps: JSON.parse(testCase.steps),
                            assignment_group: testCase.assignment_group,
                            priority: testCase.priority,
                            sys_tags: JSON.parse(testCase.sys_tags || "[]"),
                            automation_status: testCase.automation_status,
                            sys_created_on: testCase.sys_created_on,
                            sys_created_by: testCase.sys_created_by,
                            genai_generated: testCase.genai_generated,
                            similarity: similarity
                        })
                    }
                }
            }

            // Sort by similarity (highest first)
            similarTestCases.sort((a, b) => b.similarity - a.similarity);

            this.logger.info(`Found ${similarTestCases.length} similar test cases above threshold ${searchThreshold}`);
            return similarTestCases;
        } catch (error) {
            this.logger.error('Failed to search similar test cases:', error);
            throw error;
        }
    }

    async updateTestCaseId(oldTestCaseId, testCase) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }
            const newTestCaseId = testCase.sys_id;
            // ID change requested - need to delete old and create new
            this.logger.info(`Changing test case ID in vector DB: ${oldTestCaseId} → ${newTestCaseId}`);

            const oldTestCase = await this.getTestCaseById(oldTestCaseId, true);
            const embedding = oldTestCase.embeddings[0];
            const document = oldTestCase.documents[0];
            const metadata = oldTestCase.metadatas[0];
            metadata.id = newTestCaseId;
            metadata.number = testCase.number;
            metadata.sys_created_by = testCase.sys_created_by;
            metadata.sys_created_on = testCase.sys_created_on;

            // Delete the old document
            await this.collection.delete({
                ids: [oldTestCaseId]
            });

            // Create a new document with the new ID
            await this.collection.add({
                ids: [newTestCaseId],
                embeddings: [embedding],
                documents: [document],
                metadatas: [metadata]
            });

            this.logger.info(`Successfully changed test case ID in vector DB: ${oldTestCaseId} → ${newTestCaseId}`);
            return newTestCaseId;
        } catch (error) {
            this.logger.error(`Failed to update test case ${oldTestCaseId}:`, error);
            throw error;
        }
    }

    async deleteTestCase(testCaseId) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            await this.collection.delete({
                ids: [testCaseId]
            });

            this.logger.info(`Deleted test case from vector DB: ${testCaseId}`);
        } catch (error) {
            this.logger.error(`Failed to delete test case ${testCaseId}:`, error);
            throw error;
        }
    }

    async deleteCollection(collectionName = null) {
        try {
            const targetCollection = collectionName || process.env.CHROMA_COLLECTION_NAME || 'defect_test_case_rca';

            this.logger.info(`Deleting collection: ${targetCollection}`);

            await this.client.deleteCollection({
                name: targetCollection
            });

            // Reset initialization state if we deleted the current collection
            if (!collectionName || targetCollection === (process.env.CHROMA_COLLECTION_NAME || 'defect_test_case_rca')) {
                this.collection = null;
                this.isInitialized = false;
            }

            this.logger.info(`Successfully deleted collection: ${targetCollection}`);
            return true;

        } catch (error) {
            this.logger.error(`Failed to delete collection ${collectionName}:`, error);
            throw error;
        }
    }

    async listCollections() {
        try {
            const collections = await this.client.listCollections();
            this.logger.info(`Found ${collections.length} collections`);
            return collections;
        } catch (error) {
            this.logger.error('Failed to list collections:', error);
            throw error;
        }
    }

    async getCollectionStats() {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const collectionName = process.env.CHROMA_COLLECTION_NAME || 'defect_test_case_rca';
            const collection = await this.client.getCollection({
                name: collectionName
            });

            const count = await collection.count();

            return {
                name: collectionName,
                count
            };
        } catch (error) {
            this.logger.error('Failed to get collection stats:', error);
            throw error;
        }
    }

    _createTestCaseDocument(testCase) {
        // Create a comprehensive document for embedding and search
        const parts = [
            `Title: ${testCase.short_description}`,
            `Component: ${testCase.product_service}`,
            `Category: ${testCase.product_category}`,
            `Problem Type: ${testCase.facet}`,
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
                typeof step === 'string' ? `${index + 1}. ${step}` : `${index + 1}. ${step.step}`
            ).join('\r\n');
            parts.push(`Steps to reproduce: ${steps}`);
        }

        return parts.join('\n');
    }

    _createBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    async getTestCaseById(testCaseId, includeMetadata = false) {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }
            const include = ["metadatas"];
            if (includeMetadata) {
                include.push("documents", "embeddings");
            }
            // Use the get method to retrieve by exact ID
            const result = await this.collection.get({
                ids: [testCaseId],
                include
            });

            // Check if any results were found
            if (result.ids.length === 0) {
                this.logger.info(`No test case found with ID: ${testCaseId}`);
                return null;
            }
            const data = result.metadatas[0];
            // Format the result to match your application structure
            const testCase = {
                short_description: data.title,
                product_category: data.category,
                product_service: data.component,
                facet: data.facet,
                priority: data.priority,
                prerequisites: data.prerequisites,
                assignment_group: data.assignment_group,
                steps: JSON.parse(data.steps || "[]"),
                genai_generated: data.genai_generated,
                automation_status: data.automation_status,
                sys_tags: JSON.parse(data.sys_tags || "[]")
            };

            this.logger.info(`Retrieved test case: ${testCaseId}`);
            return includeMetadata ? result : testCase;
        } catch (error) {
            this.logger.error(`Failed to get test case by ID ${testCaseId}:`, error);
            throw error;
        }
    }
}

module.exports = VectorDbService;
