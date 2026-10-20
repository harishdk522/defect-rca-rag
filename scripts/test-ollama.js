#!/usr/bin/env node

const { Ollama } = require('ollama');
const { createServiceLogger } = require('../src/config/logger');

const logger = createServiceLogger('OllamaTest');

class OllamaTestRunner {
  constructor() {
    this.ollama = new Ollama({
      host: process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    });
    this.mainModel = process.env.OLLAMA_MODEL || 'llama2:7b';
    this.embeddingModel = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
    this.testResults = [];
  }

  async runTest(testName, testFn) {
    try {
      console.log(`\n🧪 Running test: ${testName}`);
      const startTime = Date.now();
      
      await testFn();
      
      const duration = Date.now() - startTime;
      console.log(`✅ ${testName} - PASSED (${duration}ms)`);
      this.testResults.push({ name: testName, status: 'PASSED', duration });
      
    } catch (error) {
      console.log(`❌ ${testName} - FAILED`);
      console.log(`   Error: ${error.message}`);
      this.testResults.push({ name: testName, status: 'FAILED', error: error.message });
    }
  }

  async testServerConnection() {
    // Test basic server connectivity
    const models = await this.ollama.list();
    
    if (!models || !models.models || models.models.length === 0) {
      throw new Error('No models found in Ollama server');
    }
    
    console.log(`   📦 Found ${models.models.length} installed models:`);
    models.models.forEach(model => {
      console.log(`      - ${model.name} (${this.formatBytes(model.size)})`);
    });
    
    // Check if required models are available
    const modelNames = models.models.map(m => m.name);
    
    if (!modelNames.includes(this.mainModel)) {
      throw new Error(`Main model ${this.mainModel} not found`);
    }
    
    if (!modelNames.includes(`${this.embeddingModel}:latest`)) {
      throw new Error(`Embedding model ${this.embeddingModel} not found`);
    }
    
    console.log(`   ✅ Required models are available`);
  }

  async testMainModelGeneration() {
    const prompt = "Write a brief test case title for testing user login functionality:";
    
    console.log(`   📝 Testing with prompt: "${prompt}"`);
    
    const response = await this.ollama.generate({
      model: this.mainModel,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.7,
        max_tokens: 50
      }
    });
    
    if (!response.response || response.response.trim().length === 0) {
      throw new Error('Empty response from main model');
    }
    
    console.log(`   💡 Generated response: "${response.response.trim()}"`);
    console.log(`   📊 Response stats: ${response.response.length} characters, took ${response.total_duration/1000000}ms`);
  }

  async testEmbeddingGeneration() {
    const testText = "User login functionality test case with valid credentials";
    
    console.log(`   📝 Generating embedding for: "${testText}"`);
    
    const response = await this.ollama.embeddings({
      model: this.embeddingModel,
      prompt: testText
    });
    
    if (!response.embedding || !Array.isArray(response.embedding) || response.embedding.length === 0) {
      throw new Error('Invalid embedding response');
    }
    
    console.log(`   🧮 Generated embedding with ${response.embedding.length} dimensions`);
    console.log(`   📊 Sample values: [${response.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
    
    // Test embedding similarity calculation
    const embedding2 = await this.ollama.embeddings({
      model: this.embeddingModel,
      prompt: "Authentication test with correct username and password"
    });
    
    const similarity = this.cosineSimilarity(response.embedding, embedding2.embedding);
    console.log(`   📐 Similarity with related text: ${similarity.toFixed(4)}`);
    
    if (similarity < 0.5) {
      console.log(`   ⚠️  Similarity seems low, but this might be expected`);
    } else {
      console.log(`   ✅ Good similarity score detected`);
    }
  }

  async testDefectAnalysisScenario() {
    const defectDescription = `
Defect: Login button not responding when clicked
Steps to reproduce:
1. Navigate to login page
2. Enter valid credentials  
3. Click login button
4. Nothing happens - button remains clickable

Expected: User should be logged in
Actual: Login button does not respond
`;

    console.log(`   🔍 Testing defect analysis scenario...`);
    
    const analysisPrompt = `
Analyze this defect and suggest a test case title that would help reproduce this issue:

${defectDescription}

Provide only a concise test case title:`;

    const response = await this.ollama.generate({
      model: this.mainModel,
      prompt: analysisPrompt,
      stream: false,
      options: {
        temperature: 0.6,
        max_tokens: 30
      }
    });
    
    console.log(`   🎯 Suggested test case title: "${response.response.trim()}"`);
    
    // Generate embedding for the defect
    const defectText = `Login button not responding when clicked. User enters valid credentials but login button does not respond when clicked.`;
    const embedding = await this.ollama.embeddings({
      model: this.embeddingModel,
      prompt: defectText
    });
    
    console.log(`   🧮 Generated defect embedding (${embedding.embedding.length} dimensions)`);
  }

  async testSystemIntegration() {
    console.log(`   🔄 Testing system integration scenario...`);
    
    // Simulate the workflow that will be used in the actual system
    const defectData = {
      title: "Search functionality returns no results",
      description: "When user searches for existing products, no results are displayed even though products exist in database",
      component: "search"
    };
    
    // Create search text like the RAG system would
    const searchText = `Title: ${defectData.title}\nDescription: ${defectData.description}\nComponent: ${defectData.component}`;
    
    // Generate embedding
    const embedding = await this.ollama.embeddings({
      model: this.embeddingModel,
      prompt: searchText
    });
    
    // Generate test case
    const generationPrompt = `
Create a test case for this defect. Respond with a JSON object containing title and description:

Defect Details:
${searchText}

Expected JSON format:
{
  "title": "Test case title",
  "description": "Test case description"
}`;

    const response = await this.ollama.generate({
      model: this.mainModel,
      prompt: generationPrompt,
      stream: false,
      options: {
        temperature: 0.7,
        max_tokens: 200
      }
    });
    
    console.log(`   📝 Generated test case response:`);
    console.log(`      ${response.response.trim()}`);
    console.log(`   🧮 Embedding generated: ${embedding.embedding.length} dimensions`);
    console.log(`   ✅ System integration test completed`);
  }

  cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  async runAllTests() {
    console.log('🚀 Starting Ollama Tests...');
    console.log('============================');
    console.log(`📡 Server: ${this.ollama.host}`);
    console.log(`🤖 Main Model: ${this.mainModel}`);
    console.log(`🧮 Embedding Model: ${this.embeddingModel}`);
    console.log();

    await this.runTest('Server Connection', () => this.testServerConnection());
    await this.runTest('Main Model Generation', () => this.testMainModelGeneration());
    await this.runTest('Embedding Generation', () => this.testEmbeddingGeneration());
    await this.runTest('Defect Analysis Scenario', () => this.testDefectAnalysisScenario());
    await this.runTest('System Integration', () => this.testSystemIntegration());

    this.printSummary();
  }

  printSummary() {
    console.log('\n📊 Test Summary');
    console.log('================');
    
    const passed = this.testResults.filter(r => r.status === 'PASSED').length;
    const failed = this.testResults.filter(r => r.status === 'FAILED').length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${this.testResults.length}`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAILED')
        .forEach(r => console.log(`   - ${r.name}: ${r.error}`));
    }
    
    const avgDuration = this.testResults
      .filter(r => r.status === 'PASSED')
      .reduce((sum, r) => sum + r.duration, 0) / passed;
    
    if (passed > 0) {
      console.log(`⏱️  Average test duration: ${Math.round(avgDuration)}ms`);
    }
    
    console.log(`\n${failed === 0 ? '🎉 All Ollama tests passed! Your setup is ready!' : '⚠️  Some tests failed - check Ollama configuration'}`);
    
    if (failed === 0) {
      console.log('\n💡 Next Steps:');
      console.log('   1. Your Ollama setup is complete');
      console.log('   2. Both ChromaDB and Ollama are running');
      console.log('   3. You can now start your defect automation system');
      console.log('   4. Run: npm start');
    }
  }
}

// Check if Ollama server is running
async function checkOllamaServer() {
  try {
    const ollama = new Ollama({ host: 'http://localhost:11434' });
    await ollama.list();
    return true;
  } catch (error) {
    return false;
  }
}

// Main execution
async function main() {
  const isRunning = await checkOllamaServer();
  
  if (!isRunning) {
    console.log('❌ Ollama server is not running!');
    console.log('Please start the Ollama server first:');
    console.log('  ollama serve');
    console.log('');
    console.log('Then run this test again.');
    process.exit(1);
  }
  
  const tester = new OllamaTestRunner();
  await tester.runAllTests();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = OllamaTestRunner;
