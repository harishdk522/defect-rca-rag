const { createServiceLogger } = require('../config/logger');

const logger = createServiceLogger('RequestLogger');

const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

    // Add request ID to request object for use in controllers
    req.requestId = requestId;

    // Log incoming request
    logger.http('Incoming request', {
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        timestamp: new Date().toISOString()
    });

    // Override res.json to log response
    const originalJson = res.json;
    res.json = function (body) {
        const duration = Date.now() - startTime;

        logger.http('Outgoing response', {
            requestId,
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            responseSize: JSON.stringify(body).length,
            timestamp: new Date().toISOString()
        });

        return originalJson.call(this, body);
    };

    // Override res.status to capture status changes
    const originalStatus = res.status;
    res.status = function (code) {
        if (code >= 400) {
            logger.warn('Request resulted in error status', {
                requestId,
                method: req.method,
                url: req.url,
                statusCode: code,
                duration: `${Date.now() - startTime}ms`
            });
        }
        return originalStatus.call(this, code);
    };

    next();
};

module.exports = requestLogger;
