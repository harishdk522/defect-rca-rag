#!/usr/bin/env node

const { ChromaClient } = require('chromadb');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const COLLECTION_NAME = 'defect_test_case_rca';

async function main() {
  try {
    // Initialize ChromaDB client
    console.log('Connecting to ChromaDB...');
    const chromaUrl = process.env.CHROMA_DB_URL || 'http://localhost:8000';
    const chroma = new ChromaClient({ path: chromaUrl });
    console.log(`Connected to ChromaDB at ${chromaUrl}`);
    
    // Get the collection
    console.log(`Looking for collection: ${COLLECTION_NAME}`);
    const collection = await chroma.getCollection({ name: COLLECTION_NAME });
    
    // Get collection info
    const collectionInfo = await collection.get();
    console.log('\n===== Collection Info =====');
    console.log(`Found ${collectionInfo.ids.length} documents in collection ${COLLECTION_NAME}`);
    
    // Get sample data (up to 10 records)
    const limit = 10;
    console.log(`\n===== Fetching ${limit} sample records =====`);
    const queryResult = await collection.get({ 
      limit: limit,
      includeMetadata: true,
      includeDocuments: true,
      includeEmbeddings: false
    });
    
    console.log(`\n===== Sample Data (showing up to ${limit} records) =====`);
    
    if (queryResult.ids.length === 0) {
      console.log('No data found in the collection!');
    } else {
      // Display sample data
      for (let i = 0; i < queryResult.ids.length; i++) {
        console.log(`\nRecord #${i+1}:`);
        console.log(`ID: ${queryResult.ids[i]}`);
        console.log(`Document: ${queryResult.documents[i]}`);
        console.log('Metadata:', JSON.stringify(queryResult.metadatas[i], null, 2));
      }
      
      // Note: To perform semantic search, you would need to configure the embedding function
      // that was used during data seeding. This requires more setup and isn't included in this
      // simple check script.
      console.log('\n===== Note About Semantic Search =====');
      console.log('To perform semantic search queries with queryTexts, you need to:');
      console.log('1. Configure the same embedding function used during data seeding');
      console.log('2. Pass that embedding function to the ChromaClient');
      console.log('3. This typically requires importing your vector embedding model');
      console.log('\nCheck your main application code to see how embeddings are configured');
    }
    
  } catch (error) {
    console.error('Error:', error);
    console.error('\nTroubleshooting Tips:');
    console.error('1. Make sure ChromaDB is running (check with `docker ps` if using Docker)');
    console.error('2. Verify the CHROMA_DB_URL in your .env file');
    console.error('3. Ensure the collection was properly seeded');
    process.exit(1);
  }
}

// Run the script
main().then(() => {
  console.log('\nDone!');
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
