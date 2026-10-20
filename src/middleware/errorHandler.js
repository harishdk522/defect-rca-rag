const { createServiceLogger } = require('../config/logger');

const logger = createServiceLogger('ErrorHandler');

const errorHandler = (err, req, res, next) => {
    const requestId = req.requestId || 'unknown';

    // Log the error
    logger.error('Unhandled error occurred', {
        requestId,
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.url,
        body: req.body,
        params: req.params,
        query: req.query
    });

    // Default error response
    let statusCode = 500;
    let message = 'Internal Server Error';
    let details = null;

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation Error';
        details = err.details;
    } else if (err.name === 'UnauthorizedError') {
        statusCode = 401;
        message = 'Unauthorized';
    } else if (err.name === 'ForbiddenError') {
        statusCode = 403;
        message = 'Forbidden';
    } else if (err.name === 'NotFoundError') {
        statusCode = 404;
        message = 'Not Found';
    } else if (err.name === 'ConflictError') {
        statusCode = 409;
        message = 'Conflict';
    } else if (err.name === 'RateLimitError') {
        statusCode = 429;
        message = 'Too Many Requests';
    }

    // Don't expose internal error details in production
    const response = {
        success: false,
        error: message,
        requestId,
        timestamp: new Date().toISOString()
    };

    if (process.env.NODE_ENV !== 'production') {
        response.details = details || err.message;
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

// Handle 404 errors for undefined routes
const notFoundHandler = (req, res) => {
    const requestId = req.requestId || 'unknown';

    logger.warn('Route not found', {
        requestId,
        method: req.method,
        url: req.url
    });

    res.status(404).json({
        success: false,
        error: 'Route not found',
        message: `Cannot ${req.method} ${req.url}`,
        requestId,
        timestamp: new Date().toISOString()
    });
};

module.exports = {
    errorHandler,
    notFoundHandler
};
