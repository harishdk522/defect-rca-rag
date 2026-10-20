#!/usr/bin/env node

const RAGService = require('../src/services/ragService');
const { logger } = require('../src/config/logger');
const ExternalApiService = require('../src/services/externalApiService');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

class TestCaseSeeder {
    constructor() {
        this.ragService = new RAGService();
        this.externalApi = new ExternalApiService();
        this.trackingFilePath = path.join(__dirname, '../data/seed-tracking.json');
    }
    
    async loadTrackingData() {
        try {
            const data = await fs.readFile(this.trackingFilePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // If file doesn't exist or is invalid, return default structure
            return {
                testCases: {
                    lastOffset: 0,
                    lastRun: null,
                    totalProcessed: 0,
                    stats: { successCount: 0, errorCount: 0 }
                },
                mappings: {
                    lastOffset: 0,
                    lastRun: null,
                    totalProcessed: 0,
                    stats: { successCount: 0, errorCount: 0 }
                }
            };
        }
    }
    
    async saveTrackingData(trackingData) {
        try {
            // Ensure directory exists
            const dir = path.dirname(this.trackingFilePath);
            try {
                await fs.mkdir(dir, { recursive: true });
            } catch (err) {
                // Directory already exists, ignore
            }
            
            await fs.writeFile(
                this.trackingFilePath,
                JSON.stringify(trackingData, null, 2),
                'utf8'
            );
            logger.debug(`Saved tracking data to ${this.trackingFilePath}`);
        } catch (error) {
            logger.error('Failed to save tracking data:', error);
        }
    }

    async seedTestCasesFromAPI(options = {}) {
        try {
            logger.info('Starting test case seeding from API...');

            const trackingData = await this.loadTrackingData();
            const testCasesTracking = trackingData.testCases;
            
            let totalProcessed = testCasesTracking.totalProcessed || 0;
            let successfullyStored = testCasesTracking.stats?.successCount || 0;
            let errorCount = testCasesTracking.stats?.errorCount || 0;
            let currentOffset = testCasesTracking.lastOffset || 0;
            let hasMore = true;
            
            const batchSize = options.batchSize || 1000;
            const totalRecords = options.totalRecords || null; // null means fetch all available

            // Interpret totalRecords as an increment from current totalProcessed
            // If totalRecords=100, and we've already processed 50, we'll process 50 more
            let targetRecordCount = totalRecords ? (totalProcessed + totalRecords) : null;
            logger.info(`Starting with ${totalProcessed} records already processed, targeting ${targetRecordCount || 'unlimited'} total records`);

            const searchCriteria = {
                limit: batchSize, // Process in batches
                offset: currentOffset,
                orderBy: 'ORDERBYDESCsys_created_on', // Newest first for consistent ordering
                ...options.searchCriteria,
                sys_created_on: "javascript:gs.dateGenerate('2023-01-01','00:00:00')",
            };

            logger.info('Starting batch processing of test cases from API', {
                batchSize,
                totalRecords: totalRecords || 'unlimited',
                searchCriteria
            });

            // Process test cases in batches
            while (hasMore) {
                try {
                    logger.info(`Processing batch starting at offset: ${currentOffset}`);

                    // Update search criteria with current offset
                    const currentSearchCriteria = {
                        ...searchCriteria,
                        offset: currentOffset
                    };
                    
                    // Fetch test cases from vendor API
                    const apiResponse = await this.externalApi.searchTestCases(currentSearchCriteria);
                    const testCases = apiResponse.testCases || [];

                    if (testCases.length === 0) {
                        logger.info('No more test cases to process');
                        hasMore = false;
                        break;
                    }

                    logger.info(`Retrieved ${testCases.length} test cases from API`);

                    // Process each test case (but respect totalRecords limit)
                    for (const testCase of testCases) {
                        // Check if we've reached the target record count
                        // We want to process exactly the number of new records specified
                        if (targetRecordCount && totalProcessed >= targetRecordCount) {
                            logger.info(`Reached target record count of ${targetRecordCount}`);
                            hasMore = false;
                            break;
                        }

                        try {
                            // Create embedding and store in vector DB
                            await this.ragService.storeTestCase(testCase);
                            successfullyStored++;
                            
                            if (successfullyStored % 100 === 0) {
                                logger.info(`Progress: ${successfullyStored} test cases processed`);
                            }
                        } catch (error) {
                            logger.error(`Failed to process test case ${testCase.sys_id}:`, error);
                            errorCount++;
                        }
                        totalProcessed++;
                    }

                    // Move to next batch
                    currentOffset += testCases.length;
                    
                    // Update tracking data periodically
                    if (totalProcessed % batchSize === 0) {
                        await this.updateTrackingData(trackingData, {
                            testCases: {
                                lastOffset: currentOffset,
                                totalProcessed,
                                stats: {
                                    successCount: successfullyStored,
                                    errorCount
                                }
                            }
                        });
                    }
                    
                    // Stop if we got fewer records than batch size (end of data)
                    if (testCases.length < batchSize) {
                        logger.info(`Reached end of test cases (received ${testCases.length} < batch size ${batchSize})`);
                        hasMore = false;
                    }

                } catch (error) {
                    logger.error('Batch processing failed:', error);
                    hasMore = false;
                }
            }

            // Final update to tracking data
            await this.updateTrackingData(trackingData, {
                testCases: {
                    lastOffset: currentOffset,
                    lastRun: new Date().toISOString(),
                    totalProcessed,
                    stats: {
                        successCount: successfullyStored,
                        errorCount
                    }
                }
            });

            logger.info('Test case seeding from API completed successfully', {
                totalProcessed,
                successfullyStored
            });

            console.log('\n✅ Test Case Seeding from API Completed Successfully!');
            console.log(`📊 Total test cases processed: ${totalProcessed}`);
            console.log(`💾 Successfully stored in vector DB: ${successfullyStored}`);
            console.log(`🔄 Processing efficiency: ${Math.round((successfullyStored/totalProcessed)*100)}%`);

            return {
                totalProcessed,
                successfullyStored
            };

        } catch (error) {
            logger.error('Test case seeding from API failed:', error);
            console.error('\n❌ Test Case Seeding from API Failed!');
            console.error(`Error: ${error.message}`);
            throw error;
        }
    }

    async updateTrackingData(trackingData, updates) {
        // Deep merge the updates
        for (const [key, value] of Object.entries(updates)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                trackingData[key] = { ...trackingData[key] || {}, ...value };
            } else {
                trackingData[key] = value;
            }
        }
        
        // Save updated tracking data
        await this.saveTrackingData(trackingData);
    }

}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    const seeder = new TestCaseSeeder();

    if (args.length === 0) {
        console.log(`
📊 Data Seeder - Usage:

Seed test cases from vendor API:
  node scripts/seedData.js test-case [--batch-size=1000] [--total-records=5000]

Examples:
  # Seed test cases
  node scripts/seedData.js test-case --batch-size=500 --total-records=2000
  
  # Other options
  node scripts/seedData.js test-case --batch-size=1000  # (fetches all available)

API Seeding Parameters:
  --batch-size=N     Number of records to fetch per API call (default: 1000)
  --total-records=N  Total number of records to seed (default: all available)

Workflow:
  Run 'test-case' to get test cases from vendor

Environment Variables Required for API seeding:
  EXTERNAL_API_BASE_URL - vendor instance URL
  EXTERNAL_CLIENT_ID - OAuth client ID
  EXTERNAL_CLIENT_SECRET - OAuth client secret
  EXTERNAL_GRANT_TYPE - OAuth grant type
    `);
        process.exit(0);
    }

    const command = args[0];

    try {
        switch (command) {
            case 'test-case':
                console.log('🌐 Starting API-based test case seeding...');
                
                // Parse optional batch size parameter
                let batchSize = 1000;
                const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
                if (batchSizeArg) {
                    batchSize = parseInt(batchSizeArg.split('=')[1]) || 1000;
                }
                
                // Parse optional total records parameter
                let totalRecords = null; // null means fetch all available
                const totalRecordsArg = args.find(arg => arg.startsWith('--total-records='));
                if (totalRecordsArg) {
                    totalRecords = parseInt(totalRecordsArg.split('=')[1]) || null;
                }
                
                console.log(`Configuration: batch-size=${batchSize}, total-records=${totalRecords || 'unlimited'}`);
                
                const result = await seeder.seedTestCasesFromAPI({ batchSize, totalRecords });
                console.log('✅ API seeding completed successfully!');
                process.exit(0);
                break;

            default:
                console.error(`❌ Unknown command: ${command}`);
                console.log('Available commands: test-case');
                process.exit(1);
        }
    } catch (error) {
        console.error(`❌ Command failed: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = TestCaseSeeder;
