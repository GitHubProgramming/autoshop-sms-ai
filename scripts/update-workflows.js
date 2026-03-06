#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// ── ai-worker.json ──────────────────────────────────────────────────────────
const aiWorkerPath = path.join(root, 'n8n/workflows/ai-worker.json');
const aiWorker = JSON.parse(fs.readFileSync(aiWorkerPath, 'utf8'));

const detectNode = aiWorker.nodes.find(n => n.id === 'detect-booking-intent');
detectNode.parameters.jsCode = [
  "// Detect booking intent from AI response",
  "const aiResponse = $('OpenAI: Chat Completion').first().json.message?.content || '';",
  "const lowerResponse = aiResponse.toLowerCase();",
  "",
  "// Booking confirmed keywords",
  "const bookingKeywords = [",
  "  'appointment is confirmed',",
  "  'booked for',",
  "  'scheduled for',",
  "  'see you on',",
  "  'appointment set',",
  "  'confirmed for',",
  "];",
  "",
  "const isBooked = bookingKeywords.some(k => lowerResponse.includes(k));",
  "",
  "// Close intent keywords (user wants to stop)",
  "const closeKeywords = ['stop', 'cancel', 'nevermind', 'never mind', 'no thanks', 'not interested'];",
  "const rawMessage = $('Build OpenAI Messages').first().json.rawMessage.toLowerCase();",
  "const userWantsClose = closeKeywords.some(k => rawMessage.includes(k));",
  "",
  "// Extract service_type from AI response",
  "const serviceMap = {",
  "  'oil change': 'Oil Change',",
  "  'brake': 'Brake Service',",
  "  'tire rotation': 'Tire Rotation',",
  "  'alignment': 'Alignment',",
  "  'transmission': 'Transmission Service',",
  "  'battery': 'Battery Replacement',",
  "  'a/c': 'AC Repair',",
  "  'ac repair': 'AC Repair',",
  "  'check engine': 'Diagnostic',",
  "  'diagnostic': 'Diagnostic',",
  "  'inspection': 'Inspection',",
  "};",
  "",
  "let serviceType = 'General Service';",
  "for (const [kw, label] of Object.entries(serviceMap)) {",
  "  if (lowerResponse.includes(kw)) {",
  "    serviceType = label;",
  "    break;",
  "  }",
  "}",
  "",
  "// Extract scheduled_at from AI response (Month Day pattern)",
  "let scheduledAt = null;",
  "const dateMatch = aiResponse.match(/\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b/i);",
  "if (dateMatch) {",
  "  const parsed = new Date(dateMatch[1] + ' ' + dateMatch[2] + ', ' + new Date().getFullYear());",
  "  if (!isNaN(parsed.getTime())) {",
  "    scheduledAt = parsed.toISOString();",
  "  }",
  "}",
  "",
  "// Refine with time if found",
  "const timeMatch = aiResponse.match(/\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b/i);",
  "if (scheduledAt && timeMatch) {",
  "  const d = new Date(scheduledAt);",
  "  let h = parseInt(timeMatch[1]);",
  "  const m = parseInt(timeMatch[2] || '0');",
  "  if (timeMatch[3].toLowerCase() === 'pm' && h < 12) h += 12;",
  "  if (timeMatch[3].toLowerCase() === 'am' && h === 12) h = 0;",
  "  d.setHours(h, m, 0, 0);",
  "  scheduledAt = d.toISOString();",
  "}",
  "",
  "// Default to tomorrow 9am if no date detected",
  "if (!scheduledAt) {",
  "  const tomorrow = new Date();",
  "  tomorrow.setDate(tomorrow.getDate() + 1);",
  "  tomorrow.setHours(9, 0, 0, 0);",
  "  scheduledAt = tomorrow.toISOString();",
  "}",
  "",
  "return [{",
  "  json: {",
  "    tenantId: $('Build OpenAI Messages').first().json.tenantId,",
  "    conversationId: $('Build OpenAI Messages').first().json.conversationId,",
  "    customerPhone: $('Build OpenAI Messages').first().json.customerPhone,",
  "    ourPhone: $('Build OpenAI Messages').first().json.ourPhone,",
  "    aiResponse,",
  "    isBooked,",
  "    userWantsClose,",
  "    serviceType,",
  "    scheduledAt,",
  "    tokensUsed: $('OpenAI: Chat Completion').first().json.usage?.total_tokens ?? 0,",
  "  }",
  "}];"
].join('\n');

// Add serviceType + scheduledAt to Trigger: Close (Booked) body params
const closeBookedNode = aiWorker.nodes.find(n => n.id === 'trigger-close-booked');
const existingParams = closeBookedNode.parameters.bodyParameters.parameters;
// Remove any stale serviceType/scheduledAt params if re-running
const filtered = existingParams.filter(p => p.name !== 'serviceType' && p.name !== 'scheduledAt');
filtered.push(
  { name: 'serviceType', value: "={{ $('Detect Booking Intent').first().json.serviceType }}" },
  { name: 'scheduledAt', value: "={{ $('Detect Booking Intent').first().json.scheduledAt }}" }
);
closeBookedNode.parameters.bodyParameters.parameters = filtered;

fs.writeFileSync(aiWorkerPath, JSON.stringify(aiWorker, null, 2));
console.log('ai-worker.json: OK');

// ── close-conversation.json ─────────────────────────────────────────────────
const closeConvPath = path.join(root, 'n8n/workflows/close-conversation.json');
const closeConv = JSON.parse(fs.readFileSync(closeConvPath, 'utf8'));

const createApptNode = closeConv.nodes.find(n => n.id === 'db-create-appointment');
createApptNode.parameters.query = [
  "SET LOCAL app.current_tenant_id = '{{ $('Webhook: Close Conversation').first().json.body.tenantId }}';",
  "INSERT INTO appointments (",
  "  tenant_id,",
  "  conversation_id,",
  "  customer_phone,",
  "  service_type,",
  "  scheduled_at,",
  "  calendar_synced",
  ")",
  "SELECT",
  "  '{{ $('Webhook: Close Conversation').first().json.body.tenantId }}'::uuid,",
  "  '{{ $('Webhook: Close Conversation').first().json.body.conversationId }}'::uuid,",
  "  c.customer_phone,",
  "  COALESCE(NULLIF('{{ $('Webhook: Close Conversation').first().json.body.serviceType }}', ''), 'General Service'),",
  "  COALESCE(NULLIF('{{ $('Webhook: Close Conversation').first().json.body.scheduledAt }}', '')::timestamptz, NOW() + INTERVAL '1 day'),",
  "  FALSE",
  "FROM conversations c",
  "WHERE c.id = '{{ $('Webhook: Close Conversation').first().json.body.conversationId }}'::uuid",
  "RETURNING id;"
].join('\n');

// Remove the TODO note since it is now resolved
delete createApptNode.notes;

fs.writeFileSync(closeConvPath, JSON.stringify(closeConv, null, 2));
console.log('close-conversation.json: OK');

// Validate both files parse cleanly
JSON.parse(fs.readFileSync(aiWorkerPath, 'utf8'));
JSON.parse(fs.readFileSync(closeConvPath, 'utf8'));
console.log('Both JSON files valid.');
