#!/usr/bin/env python3
"""
Test script for ChromaDB connection and basic operations
"""

import chromadb
import sys
import json
from datetime import datetime

def test_chromadb_connection():
    """Test basic ChromaDB connection and operations"""
    
    print("🧪 Testing ChromaDB Connection...")
    print("=" * 50)
    
    try:
        # Connect to ChromaDB server
        print("📡 Connecting to ChromaDB server...")
        client = chromadb.HttpClient(host='localhost', port=8000)
        
        # Test connection by getting server version/heartbeat
        print("💓 Testing server heartbeat...")
        heartbeat = client.heartbeat()
        print(f"✅ Server heartbeat: {heartbeat}")
        
        # List existing collections
        print("\n📚 Listing existing collections...")
        collections = client.list_collections()
        print(f"📋 Found {len(collections)} existing collections")
        for collection in collections:
            print(f"   - {collection.name}")
        
        # Create a test collection
        print("\n🔧 Creating test collection...")
        test_collection_name = "test_collection"
        
        # Delete if exists (for clean test)
        try:
            client.delete_collection(name=test_collection_name)
            print(f"🗑️  Deleted existing test collection")
        except:
            pass
            
        # Create new test collection
        collection = client.create_collection(
            name=test_collection_name,
            metadata={"description": "Test collection for ChromaDB setup verification"}
        )
        print(f"✅ Created test collection: {test_collection_name}")
        
        # Add some test documents with embeddings
        print("\n📄 Adding test documents...")
        
        test_documents = [
            "User login functionality test case",
            "Search feature validation test",
            "Shopping cart functionality test case"
        ]
        
        # Generate simple embeddings (normally you'd use a proper embedding model)
        test_embeddings = [
            [0.1, 0.2, 0.3, 0.4, 0.5] * 20,  # 100 dimensions
            [0.2, 0.3, 0.4, 0.5, 0.6] * 20,
            [0.3, 0.4, 0.5, 0.6, 0.7] * 20
        ]
        
        test_ids = ["test_1", "test_2", "test_3"]
        test_metadatas = [
            {"category": "authentication", "priority": "high"},
            {"category": "search", "priority": "medium"},
            {"category": "ecommerce", "priority": "high"}
        ]
        
        collection.add(
            documents=test_documents,
            embeddings=test_embeddings,
            ids=test_ids,
            metadatas=test_metadatas
        )
        print(f"✅ Added {len(test_documents)} test documents")
        
        # Test querying
        print("\n🔍 Testing similarity search...")
        query_embedding = [0.15, 0.25, 0.35, 0.45, 0.55] * 20  # Similar to first document
        
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=2,
            include=['documents', 'metadatas', 'distances']
        )
        
        print(f"🔍 Query returned {len(results['documents'][0])} results:")
        for i, (doc, metadata, distance) in enumerate(zip(
            results['documents'][0], 
            results['metadatas'][0], 
            results['distances'][0]
        )):
            print(f"   {i+1}. Document: {doc[:50]}...")
            print(f"      Category: {metadata['category']}")
            print(f"      Distance: {distance:.4f}")
            print()
        
        # Test collection stats
        print("\n📊 Collection statistics...")
        count = collection.count()
        print(f"📈 Total documents in collection: {count}")
        
        # Clean up test collection
        print("\n🧹 Cleaning up...")
        client.delete_collection(name=test_collection_name)
        print("✅ Test collection deleted")
        
        print("\n🎉 All ChromaDB tests passed successfully!")
        return True
        
    except Exception as e:
        print(f"\n❌ ChromaDB test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def test_configuration():
    """Test ChromaDB configuration for the defect automation system"""
    
    print("\n🔧 Testing Defect Automation System Configuration...")
    print("=" * 55)
    
    try:
        client = chromadb.HttpClient(host='localhost', port=8000)
        
        # Test creating the actual collection that will be used
        collection_name = "test_cases"  # From your .env file
        
        print(f"🏗️  Testing creation of '{collection_name}' collection...")
        
        # Delete if exists
        try:
            client.delete_collection(name=collection_name)
            print("🗑️  Deleted existing collection for clean test")
        except:
            pass
        
        # Create the collection with proper metadata
        collection = client.create_collection(
            name=collection_name,
            metadata={
                "description": "Test cases for defect automation system",
                "created_at": datetime.now().isoformat(),
                "system": "defect-automation"
            }
        )
        
        print(f"✅ Successfully created '{collection_name}' collection")
        print(f"📋 Collection metadata: {collection.metadata}")
        
        # Test with realistic test case data structure
        print("\n📝 Testing with realistic test case structure...")
        
        sample_test_case = {
            "id": "TC-001",
            "title": "User Login with Valid Credentials",
            "description": "Verify that user can successfully login with valid username and password",
            "category": "functional",
            "component": "authentication",
            "priority": "high"
        }
        
        # Create document text (similar to what your system will do)
        document_text = f"""Title: {sample_test_case['title']}
Description: {sample_test_case['description']}
Category: {sample_test_case['category']}
Component: {sample_test_case['component']}"""
        
        # Add the test case
        collection.add(
            documents=[document_text],
            ids=[sample_test_case['id']],
            embeddings=[[0.1] * 100],  # Placeholder embedding
            metadatas=[{
                "id": sample_test_case['id'],
                "title": sample_test_case['title'],
                "category": sample_test_case['category'],
                "component": sample_test_case['component'],
                "priority": sample_test_case['priority']
            }]
        )
        
        print("✅ Added sample test case successfully")
        
        # Test retrieval
        results = collection.get(ids=[sample_test_case['id']])
        print("✅ Retrieved test case successfully")
        print(f"📄 Retrieved document: {results['documents'][0][:80]}...")
        
        # Clean up
        client.delete_collection(name=collection_name)
        print("✅ Cleaned up test collection")
        
        print("\n🎉 Configuration test completed successfully!")
        print("✅ ChromaDB is ready for the defect automation system!")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Configuration test failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("🚀 ChromaDB Setup Verification")
    print("=" * 40)
    print(f"⏰ Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Run basic connection test
    basic_test_passed = test_chromadb_connection()
    
    # Run configuration test
    config_test_passed = test_configuration()
    
    print("\n" + "=" * 40)
    print("📊 TEST SUMMARY")
    print("=" * 40)
    print(f"🔗 Basic Connection Test: {'✅ PASSED' if basic_test_passed else '❌ FAILED'}")
    print(f"⚙️  Configuration Test: {'✅ PASSED' if config_test_passed else '❌ FAILED'}")
    
    if basic_test_passed and config_test_passed:
        print("\n🎉 ChromaDB setup is complete and ready!")
        print("💡 Next steps:")
        print("   1. Keep ChromaDB server running")
        print("   2. Install and configure Ollama")
        print("   3. Start your defect automation system")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. Please check the configuration.")
        sys.exit(1)
