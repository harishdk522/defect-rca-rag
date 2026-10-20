const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// Ensure logs directory exists
const fs = require('fs');
const logDir = process.env.LOG_DIR || './logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for logs
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.prettyPrint()
);

// Console format for development
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        let log = `${timestamp} [${level}]`;
        if (service) log += ` [${service}]`;
        log += `: ${message}`;

        // Add metadata if present
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        if (metaStr) log += `\n${metaStr}`;

        return log;
    })
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: 'defect-rca-rag' },
    transports: [
        // Error logs
        new DailyRotateFile({
            filename: path.join(logDir, 'error-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxSize: process.env.LOG_MAX_SIZE || '20m',
            maxFiles: process.env.LOG_MAX_FILES || '14d',
            zippedArchive: true
        }),

        // Combined logs
        new DailyRotateFile({
            filename: path.join(logDir, 'combined-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: process.env.LOG_MAX_SIZE || '20m',
            maxFiles: process.env.LOG_MAX_FILES || '14d',
            zippedArchive: true
        }),

        // API request logs
        new DailyRotateFile({
            filename: path.join(logDir, 'api-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            level: 'http',
            maxSize: process.env.LOG_MAX_SIZE || '20m',
            maxFiles: process.env.LOG_MAX_FILES || '7d',
            zippedArchive: true
        })
    ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat,
        level: 'debug'
    }));
}

// Create child loggers for different services
const createServiceLogger = (serviceName) => {
    return logger.child({ service: serviceName });
};

// Log uncaught exceptions and unhandled rejections
logger.exceptions.handle(
    new DailyRotateFile({
        filename: path.join(logDir, 'exceptions-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d'
    })
);

logger.rejections.handle(
    new DailyRotateFile({
        filename: path.join(logDir, 'rejections-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '30d'
    })
);

module.exports = {
    logger,
    createServiceLogger
};
