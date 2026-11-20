import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
// Temporarily disabled metrics due to version incompatibility
// import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
// import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { logger } from './logger';

/**
 * Initialize OpenTelemetry instrumentation
 * This should be called at the very start of the application
 */
export function initTelemetry(serviceName: string): NodeSDK | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  
  // Skip telemetry if not configured
  if (!endpoint) {
    logger.info('OpenTelemetry not configured - skipping instrumentation');
    return null;
  }

  try {
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      'service.namespace': 'flashsale',
      'service.instance.id': `${serviceName}-${process.pid}`,
    });

    // Trace exporter configuration
    const traceExporter = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      headers: {},
    });

    // Metrics exporter configuration (disabled temporarily)
    // const metricExporter = new OTLPMetricExporter({
    //   url: `${endpoint}/v1/metrics`,
    //   headers: {},
    // });

    // const metricReader = new PeriodicExportingMetricReader({
    //   exporter: metricExporter,
    //   exportIntervalMillis: 10000, // Export every 10 seconds
    // });

    // Initialize OpenTelemetry SDK
    const sdk = new NodeSDK({
      resource,
      traceExporter,
      // metricReader, // Disabled temporarily
      instrumentations: [
        // Auto-instrumentation for common libraries
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false, // Disable fs to reduce noise
          },
          '@opentelemetry/instrumentation-dns': {
            enabled: false, // Disable DNS to reduce noise
          },
        }),
        // Explicit instrumentations for better control
        new HttpInstrumentation({
          requestHook: (span, request) => {
            const headers = 'headers' in request ? request.headers : {};
            span.setAttribute('http.request.body.size', headers['content-length'] || 0);
          },
        }),
        new ExpressInstrumentation(),
        new IORedisInstrumentation({
          dbStatementSerializer: (cmdName, cmdArgs) => {
            // Sanitize Redis commands to avoid leaking sensitive data
            return `${cmdName} ${cmdArgs.length > 0 ? '[...]' : ''}`;
          },
        }),
        new PgInstrumentation({
          enhancedDatabaseReporting: true,
        }),
      ],
    });

    // Start the SDK
    sdk.start();

    logger.info({
      serviceName,
      endpoint,
      resource: resource.attributes,
    }, 'OpenTelemetry instrumentation initialized');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      sdk
        .shutdown()
        .then(() => logger.info('OpenTelemetry SDK shut down successfully'))
        .catch((error) => logger.error({ error }, 'Error shutting down OpenTelemetry SDK'))
        .finally(() => process.exit(0));
    });

    return sdk;
  } catch (error) {
    logger.error({ error }, 'Failed to initialize OpenTelemetry');
    return null;
  }
}

/**
 * Helper to get the current trace context for logging
 */
export function getTraceContext() {
  const { trace, context } = require('@opentelemetry/api');
  const span = trace.getSpan(context.active());
  
  if (!span) {
    return {};
  }

  const spanContext = span.spanContext();
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

/**
 * Create a custom span for manual instrumentation
 */
export function createSpan(name: string, attributes?: Record<string, any>) {
  const { trace, context } = require('@opentelemetry/api');
  const tracer = trace.getTracer('flashsale-custom-instrumentation');
  
  return tracer.startSpan(name, {
    attributes: attributes || {},
  }, context.active());
}

/**
 * Record an exception in the current span
 */
export function recordException(error: Error, attributes?: Record<string, any>) {
  const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
  const span = trace.getSpan(context.active());
  
  if (span) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
  }
}

/**
 * Add custom attributes to the current span
 */
export function addSpanAttributes(attributes: Record<string, any>) {
  const { trace, context } = require('@opentelemetry/api');
  const span = trace.getSpan(context.active());
  
  if (span) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }
}
