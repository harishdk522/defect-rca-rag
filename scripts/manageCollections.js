#!/usr/bin/env node

const VectorDbService = require('../src/services/vectorDbService');
const { logger } = require('../src/config/logger');
require('dotenv').config();

async function manageCollections() {
    const action = process.argv[2];
    const collectionName = process.argv[3];

    const vectorDb = new VectorDbService();
    await vectorDb.initialize();
    try {
        switch (action) {
            case 'list':
                console.log('📚 Listing all collections...');
                const collections = await vectorDb.listCollections();
                if (collections.length === 0) {
                    console.log('No collections found.');
                } else {
                    console.log(`Found ${collections.length} collection(s):`);
                    collections.forEach((collection, index) => {
                        // ChromaDB returns collection names as strings, not objects
                        const collectionName = typeof collection === 'string' ? collection : 
                                              (collection.name || collection.id || collection.identifier || 'unknown');
                        console.log(`${index + 1}. ${collectionName}`);
                    });
                }
                break;

            case 'delete':
                if (!collectionName) {
                    console.error('❌ Please provide a collection name to delete');
                    console.log('Usage: node scripts/manageCollections.js delete <collection_name>');
                    process.exit(1);
                }
                console.log(`🗑️  Deleting collection: ${collectionName}`);
                await vectorDb.deleteCollection(collectionName);
                console.log('✅ Collection deleted successfully!');
                break;

            case 'delete-default':
                console.log('🗑️  Deleting default collection...');
                await vectorDb.deleteCollection();
                console.log('✅ Default collection deleted successfully!');
                break;

            case 'stats':
                console.log('📊 Getting collection statistics...');
                const stats = await vectorDb.getCollectionStats();
                console.log('Collection Stats:', stats);
                break;

            default:
                console.log('📋 Collection Management Tool');
                console.log('=============================');
                console.log('Available commands:');
                console.log('  list              - List all collections');
                console.log('  delete <name>     - Delete a specific collection');
                console.log('  delete-default    - Delete the default collection');
                console.log('  stats             - Show collection statistics');
                console.log('');
                console.log('Examples:');
                console.log('  node scripts/manageCollections.js list');
                console.log('  node scripts/manageCollections.js delete my_collection');
                console.log('  node scripts/manageCollections.js delete-default');
                process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        logger.error('Collection management failed:', error);
        process.exit(1);
    }
}

manageCollections();
