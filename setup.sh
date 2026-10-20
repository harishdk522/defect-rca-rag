#!/bin/bash

# AI-Powered Defect RCA & Test Case Generation System - Setup Script
# This script helps you set up all required dependencies

set -e

echo "🚀 Setting up AI-Powered Defect RCA & Test Case Generation System..."
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check if Node.js is installed
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_status "Node.js is installed: $NODE_VERSION"
        
        # Check if version is >= 16
        MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [ "$MAJOR_VERSION" -ge 16 ]; then
            print_status "Node.js version is compatible"
        else
            print_error "Node.js version must be >= 16. Please upgrade."
            exit 1
        fi
    else
        print_error "Node.js is not installed. Please install Node.js >= 16"
        exit 1
    fi
}

# Check if Python is installed (for ChromaDB)
check_python() {
    if command -v python3 &> /dev/null; then
        PYTHON_VERSION=$(python3 --version)
        print_status "Python is installed: $PYTHON_VERSION"
    else
        print_error "Python 3 is not installed. Please install Python 3"
        exit 1
    fi
}

# Check if Homebrew is installed
check_homebrew() {
    if command -v brew &> /dev/null; then
        print_status "Homebrew is installed"
    else
        print_info "Installing Homebrew (may require password)..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        print_status "Homebrew installed successfully"
    fi
}

# Install Ollama using Homebrew
install_ollama() {
    if command -v ollama &> /dev/null; then
        print_status "Ollama is already installed"
    else
        print_info "Installing Ollama for macOS using Homebrew..."
        brew install ollama
        print_status "Ollama installed successfully"
        print_info "Documentation: https://ollama.ai/download/mac"
    fi
}

# Pull required Ollama models
pull_ollama_models() {
    print_info "Pulling required Ollama models (this may take a while)..."
    
    # Check if models are already pulled
    if ollama list | grep -q "llama2:7b"; then
        print_status "llama2:7b model already exists"
    else
        print_info "Pulling llama2:7b model..."
        ollama pull llama2:7b
        print_status "llama2:7b model pulled successfully"
    fi
    
    if ollama list | grep -q "nomic-embed-text"; then
        print_status "nomic-embed-text model already exists"
    else
        print_info "Pulling nomic-embed-text model..."
        ollama pull nomic-embed-text
        print_status "nomic-embed-text model pulled successfully"
    fi
}

# Install ChromaDB and CLI using pip and Homebrew
install_chromadb() {
    print_info "Installing ChromaDB for macOS..."
    
    # Use Python from Homebrew for consistency
    if ! brew list python@3.10 &> /dev/null; then
        print_info "Installing Python 3.10 via Homebrew..."
        brew install python@3.10
    fi
    
    # Create and activate a virtual environment for ChromaDB
    print_info "Setting up virtual environment for ChromaDB..."
    python3 -m venv venv
    source venv/bin/activate
    
    # Install ChromaDB and its dependencies
    print_info "Installing ChromaDB and dependencies..."
    pip install --upgrade pip
    pip install chromadb
    
    # Install Chroma CLI via npm (no Homebrew package available yet)
    print_info "Installing Chroma CLI globally..."
    npm install -g chromadb-cli --registry=https://registry.npmjs.org/
    
    # Deactivate virtual environment
    deactivate
    
    # Create a simple wrapper script to activate venv and run ChromaDB
    print_info "Creating ChromaDB start script..."
    cat > chroma-start.sh << 'EOL'
#!/bin/bash
source "$(dirname "$0")/venv/bin/activate"
chroma run --host localhost --port 8000
EOL
    chmod +x chroma-start.sh
    
    print_status "ChromaDB installed successfully"
    print_info "To start ChromaDB manually: ./chroma-start.sh"
    print_info "Documentation: https://docs.trychroma.com/getting-started"
}

# Create necessary directories
create_directories() {
    print_info "Creating necessary directories..."
    mkdir -p data logs
    print_status "Directories created"
}

# Install npm dependencies
install_npm_deps() {
    if [ -f "package.json" ]; then
        print_info "Installing npm dependencies..."
        npm install
        print_status "npm dependencies installed"
    else
        print_error "package.json not found. Make sure you're in the project directory."
        exit 1
    fi
}

# Start services function
start_services() {
    print_info "Starting required services..."
    
    # Start Ollama in background
    print_info "Starting Ollama server..."
    if pgrep -f "ollama serve" > /dev/null; then
        print_warning "Ollama server is already running"
    else
        ollama serve &
        OLLAMA_PID=$!
        echo $OLLAMA_PID > .ollama.pid
        print_info "Ollama PID: $OLLAMA_PID (saved to .ollama.pid)"
        sleep 3
    fi
    
    # Start ChromaDB in background
    print_info "Starting ChromaDB server..."
    if pgrep -f "chroma run" > /dev/null; then
        print_warning "ChromaDB server is already running"
    else
        print_info "Activating virtual environment for ChromaDB..."
        source venv/bin/activate
        chroma run --host localhost --port 8000 &
        CHROMA_PID=$!
        echo $CHROMA_PID > .chroma.pid
        deactivate
        print_info "ChromaDB PID: $CHROMA_PID (saved to .chroma.pid)"
        sleep 3
    fi
    
    # Check if services are accessible
    print_info "Verifying services are accessible..."
    if curl -s http://localhost:11434/api/version > /dev/null; then
        print_status "Ollama API is accessible"
    else
        print_warning "Ollama API might not be accessible yet"
    fi
    
    if curl -s http://localhost:8000/api/v1 > /dev/null; then
        print_status "ChromaDB API is accessible"
    else
        print_warning "ChromaDB API might not be accessible yet"
    fi
    
    print_status "Services started successfully"
}

# Stop services function
stop_services() {
    print_info "Stopping services..."
    
    if [ -f ".ollama.pid" ]; then
        OLLAMA_PID=$(cat .ollama.pid)
        kill $OLLAMA_PID 2>/dev/null || true
        rm .ollama.pid
        print_status "Ollama stopped"
    fi
    
    if [ -f ".chroma.pid" ]; then
        CHROMA_PID=$(cat .chroma.pid)
        kill $CHROMA_PID 2>/dev/null || true
        rm .chroma.pid
        print_status "ChromaDB stopped"
    fi
}

# Create or update .env file
create_env_file() {
    print_info "Setting up environment configuration..."
    
    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        print_info "Creating .env file from template"
        cat > .env << EOL
# Server Configuration
PORT=3333
NODE_ENV=development
CONSOLE_LOG_LEVEL=debug

# External API Configuration
EXTERNAL_API_BASE_URL=https://your-vendor-instance.service-now.com
EXTERNAL_API_USERNAME=your_username
EXTERNAL_API_PASSWORD=your_password
EXTERNAL_API_CLIENT_ID=your_client_id
EXTERNAL_API_CLIENT_SECRET=your_client_secret

# Ollama LLM Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2:7b
EMBEDDING_MODEL=nomic-embed-text

# ChromaDB Configuration
CHROMA_HOST=localhost
CHROMA_PORT=8000
CHROMA_COLLECTION_NAME=defect_test_case_rca

# Vector Similarity Configuration
SIMILARITY_THRESHOLD=0.65
EOL
        print_status ".env file created successfully"
        print_warning "You need to update the .env file with your actual API credentials"
    else
        print_status ".env file already exists"
    fi
}

# Main setup function
setup() {
    echo
    print_info "Starting setup process for macOS..."
    echo
    
    check_nodejs
    check_python
    check_homebrew
    create_directories
    install_npm_deps
    install_ollama
    pull_ollama_models
    install_chromadb
    create_env_file
    
    echo
    print_status "Setup completed successfully!"
    echo
    print_info "Next steps:"
    echo "1. Update .env file with your vendor API credentials"
    echo "2. Run: ./setup.sh start                              # Start required services"
    echo "3. Run: node scripts/seedData.js test-case --batch-size=100  # Seed test cases from vendor"
    echo "4. Run: npm start                                     # Start the application"
    echo "5. Access the application at: http://localhost:3333"
    echo
    print_info "Useful commands:"
    echo "  ./setup.sh start    - Start Ollama and ChromaDB services"
    echo "  ./setup.sh stop     - Stop all services"
    echo "  ./setup.sh status   - Check service status"
    echo
    print_info "Documentation links:"
    echo "  Ollama: https://ollama.ai/download/mac"
    echo "  ChromaDB: https://docs.trychroma.com/getting-started"
    echo "  Node.js: https://nodejs.org/en/download/"
}

# Check service status
check_status() {
    print_info "Checking service status..."
    
    # Check Ollama
    if curl -s http://localhost:11434/api/version > /dev/null 2>&1; then
        print_status "Ollama is running"
    else
        print_warning "Ollama is not running"
    fi
    
    # Check ChromaDB
    if curl -s http://localhost:8000/api/v2/heartbeat > /dev/null 2>&1; then
        print_status "ChromaDB is running"
    else
        print_warning "ChromaDB is not running"
    fi
    
    # Check if Node.js app is running
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        print_status "Defect Automation API is running"
    else
        print_warning "Defect Automation API is not running"
    fi
}

# Handle script arguments
case "${1:-setup}" in
    "setup")
        setup
        ;;
    "start")
        start_services
        ;;
    "stop")
        stop_services
        ;;
    "status")
        check_status
        ;;
    "help")
        echo "Usage: ./setup.sh [command]"
        echo "Commands:"
        echo "  setup   - Run full setup (default)"
        echo "  start   - Start Ollama and ChromaDB services"
        echo "  stop    - Stop all services"
        echo "  status  - Check service status"
        echo "  help    - Show this help message"
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use './setup.sh help' for available commands"
        exit 1
        ;;
esac
