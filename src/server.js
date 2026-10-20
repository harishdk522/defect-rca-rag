const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { logger } = require('./config/logger');
const requestLogger = require('./middleware/requestLogger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const DefectController = require('./controllers/defectController');

class DefectAutomationServer {
    constructor() {
        this.app = express();
        this.port = process.env.PORT || 3000;
        this.defectController = new DefectController();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupErrorHandling();
    }

    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                },
            },
        }));

        // CORS configuration
        this.app.use(cors({
            origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
            credentials: true
        }));

        // Compression middleware
        this.app.use(compression());

        // Rate limiting
        const limiter = rateLimit({
            windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
            max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
            message: {
                success: false,
                error: 'Too many requests',
                message: 'Rate limit exceeded. Please try again later.'
            },
            standardHeaders: true,
            legacyHeaders: false,
        });
        this.app.use('/api', limiter);

        // Body parsing middleware
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Request logging
        this.app.use(requestLogger);

        // Request ID middleware
        this.app.use((req, res, next) => {
            if (!req.headers['x-request-id']) {
                req.headers['x-request-id'] = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            }
            next();
        });
    }

    setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development'
            });
        });

        // API routes
        const apiRouter = express.Router();

        // API 1: Analyze defect and find/generate matching test cases
        apiRouter.get('/defects/:defectNumber/analyze',
            this.defectController.analyzeDefect.bind(this.defectController)
        );

        // API 2: Create mapping between defect and test case, generate RCA
        apiRouter.get('/defects/:defectNumber/testcases/:testCaseId/mappings',
            this.defectController.createMapping.bind(this.defectController)
        );

        // System health check with detailed service status
        apiRouter.get('/health',
            this.defectController.healthCheck.bind(this.defectController)
        );

        // Mount API router
        this.app.use('/api/v1', apiRouter);

        // Root endpoint
        this.app.get('/', (req, res) => {
            res.json({
                name: 'Defect Automation System',
                version: '1.0.0',
                description: 'AI-powered defect automation system with RAG for test case matching and RCA generation',
                endpoints: {
                    health: '/health',
                    analyzeDefect: 'GET /api/v1/defects/{defectNumber}/analyze',
                    createMapping: 'POST /api/v1/defects/{defectNumber}/mappings',
                    systemHealth: 'GET /api/v1/health'
                },
                documentation: 'See README.md for detailed API documentation'
            });
        });
    }

    setupErrorHandling() {
        // 404 handler for undefined routes
        this.app.use(notFoundHandler);

        // Global error handler
        this.app.use(errorHandler);

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            process.exit(1);
        });

        // Graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received, shutting down gracefully');
            this.shutdown();
        });

        process.on('SIGINT', () => {
            logger.info('SIGINT received, shutting down gracefully');
            this.shutdown();
        });
    }

    async start() {
        try {
            // Initialize services
            logger.info('Initializing services...');
            await this.defectController.initialize();

            // Start server
            this.server = this.app.listen(this.port, () => {
                logger.info(`🚀 Defect Automation Server started successfully`);
                logger.info(`📡 Server running on port ${this.port}`);
                logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
                logger.info(`📋 API Base URL: http://localhost:${this.port}/api/v1`);
                logger.info(`💡 Health Check: http://localhost:${this.port}/health`);

                // Log API endpoints
                logger.info('📚 Available API Endpoints:');
                logger.info(`   GET  /api/v1/defects/{defectNumber}/analyze - Analyze defect and find matching test cases`);
                logger.info(`   POST /api/v1/defects/{defectNumber}/mappings - Create mapping and generate RCA`);
                logger.info(`   GET  /api/v1/health - System health check`);
            });

            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    logger.error(`Port ${this.port} is already in use`);
                } else {
                    logger.error('Server error:', error);
                }
                process.exit(1);
            });

        } catch (error) {
            logger.error('Failed to start server:', error);
            process.exit(1);
        }
    }

    async shutdown() {
        logger.info('Shutting down server...');

        if (this.server) {
            this.server.close((error) => {
                if (error) {
                    logger.error('Error during server shutdown:', error);
                    process.exit(1);
                } else {
                    logger.info('Server shut down successfully');
                    process.exit(0);
                }
            });
        } else {
            process.exit(0);
        }
    }
}

// Start server if this file is run directly
if (require.main === module) {
    const server = new DefectAutomationServer();
    server.start().catch((error) => {
        logger.error('Failed to start application:', error);
        process.exit(1);
    });
}

module.exports = DefectAutomationServer;
