import type { ComponentKind } from './types';

export type Category = 'Clients' | 'Edge & Network' | 'Compute' | 'Data' | 'Messaging' | 'Platform';

export interface CatalogItem {
  kind: ComponentKind;
  name: string;
  category: Category;
  w: number;
  h: number;
  color: string; // palette token used as fill tint
  keywords: string;
}

export const CATALOG: CatalogItem[] = [
  { kind: 'user', name: 'User', category: 'Clients', w: 90, h: 110, color: 'blue', keywords: 'person actor customer' },
  { kind: 'browser', name: 'Web App', category: 'Clients', w: 150, h: 110, color: 'blue', keywords: 'browser client spa frontend' },
  { kind: 'mobile', name: 'Mobile App', category: 'Clients', w: 110, h: 130, color: 'blue', keywords: 'ios android phone client' },

  { kind: 'dns', name: 'DNS', category: 'Edge & Network', w: 120, h: 100, color: 'violet', keywords: 'route53 domain resolve' },
  { kind: 'cdn', name: 'CDN', category: 'Edge & Network', w: 130, h: 110, color: 'violet', keywords: 'cloudfront edge cache static' },
  { kind: 'lb', name: 'Load Balancer', category: 'Edge & Network', w: 150, h: 100, color: 'violet', keywords: 'lb nginx elb alb haproxy' },
  { kind: 'gateway', name: 'API Gateway', category: 'Edge & Network', w: 150, h: 110, color: 'violet', keywords: 'gateway proxy edge api' },
  { kind: 'firewall', name: 'Rate Limiter', category: 'Edge & Network', w: 140, h: 100, color: 'red', keywords: 'waf firewall throttle rate limit' },

  { kind: 'server', name: 'App Server', category: 'Compute', w: 140, h: 120, color: 'green', keywords: 'server host vm backend api' },
  { kind: 'service', name: 'Service', category: 'Compute', w: 140, h: 110, color: 'green', keywords: 'microservice container pod' },
  { kind: 'worker', name: 'Worker', category: 'Compute', w: 130, h: 110, color: 'green', keywords: 'consumer job background processor' },
  { kind: 'lambda', name: 'Function', category: 'Compute', w: 120, h: 110, color: 'green', keywords: 'lambda serverless faas' },
  { kind: 'cron', name: 'Scheduler', category: 'Compute', w: 130, h: 110, color: 'green', keywords: 'cron timer batch' },

  { kind: 'sql', name: 'SQL DB', category: 'Data', w: 120, h: 130, color: 'orange', keywords: 'postgres mysql relational database rdbms' },
  { kind: 'nosql', name: 'NoSQL DB', category: 'Data', w: 120, h: 130, color: 'orange', keywords: 'dynamo cassandra mongo document kv' },
  { kind: 'cache', name: 'Cache', category: 'Data', w: 130, h: 100, color: 'red', keywords: 'redis memcached in-memory' },
  { kind: 'storage', name: 'Object Store', category: 'Data', w: 130, h: 120, color: 'orange', keywords: 's3 blob gcs files bucket' },
  { kind: 'search', name: 'Search Index', category: 'Data', w: 140, h: 100, color: 'yellow', keywords: 'elasticsearch opensearch lucene' },
  { kind: 'warehouse', name: 'Data Warehouse', category: 'Data', w: 150, h: 120, color: 'yellow', keywords: 'analytics olap snowflake bigquery lake' },

  { kind: 'queue', name: 'Queue', category: 'Messaging', w: 170, h: 90, color: 'teal', keywords: 'sqs rabbitmq message queue' },
  { kind: 'stream', name: 'Event Stream', category: 'Messaging', w: 170, h: 110, color: 'teal', keywords: 'kafka kinesis log partitions' },
  { kind: 'pubsub', name: 'Pub/Sub', category: 'Messaging', w: 130, h: 110, color: 'teal', keywords: 'sns topic fanout broadcast' },
  { kind: 'notify', name: 'Notifications', category: 'Messaging', w: 140, h: 110, color: 'teal', keywords: 'push email sms apns fcm' },

  { kind: 'auth', name: 'Auth', category: 'Platform', w: 120, h: 110, color: 'pink', keywords: 'identity oauth login jwt' },
  { kind: 'monitor', name: 'Monitoring', category: 'Platform', w: 140, h: 110, color: 'pink', keywords: 'metrics logs tracing observability' },
  { kind: 'ml', name: 'ML Model', category: 'Platform', w: 130, h: 110, color: 'pink', keywords: 'ai inference ranking recommender' },
  { kind: 'external', name: 'External API', category: 'Platform', w: 160, h: 110, color: 'gray', keywords: 'third party payment stripe cloud' },
];

export const CATALOG_BY_KIND: Record<string, CatalogItem> = Object.fromEntries(CATALOG.map((c) => [c.kind, c]));

export const CATEGORIES: Category[] = ['Clients', 'Edge & Network', 'Compute', 'Data', 'Messaging', 'Platform'];
