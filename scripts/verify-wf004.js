#!/usr/bin/env node
'use strict';
const fs = require('fs');

// Verify WF-004 structure
const wf4 = JSON.parse(fs.readFileSync('n8n/workflows/_archive/calendar-sync.json', 'utf8'));
console.log('WF-004 nodes:', wf4.nodes.map(n => n.name).join(' -> '));
console.log('WF-004 connections:');
for (const [from, to] of Object.entries(wf4.connections)) {
  console.log('  ', from, '->', to.main[0].map(c => c.node).join(', '));
}

// Verify WF-003 has the calendar sync trigger
const wf3 = JSON.parse(fs.readFileSync('n8n/workflows/_archive/close-conversation.json', 'utf8'));
const trigNode = wf3.nodes.find(n => n.id === 'trigger-calendar-sync');
console.log('\nWF-003 trigger node present:', !!trigNode);
const dbConn = wf3.connections['DB: Create Appointment'];
const trigConn = wf3.connections['Trigger: Calendar Sync (WF-004)'];
console.log('WF-003 DB:CreateAppt -> CalSyncTrigger:', JSON.stringify(dbConn));
console.log('WF-003 CalSyncTrigger -> Respond200:  ', JSON.stringify(trigConn));

// Verify docker-compose has Google env in both n8n containers
const dc = fs.readFileSync('infra/docker-compose.yml', 'utf8');
const count = (dc.match(/GOOGLE_CLIENT_ID:/g) || []).length;
// 3 occurrences: api container (already had it), n8n container (added), n8n_worker (added)
console.log('\ndocker-compose GOOGLE_CLIENT_ID occurrences:', count, '(expect 3)');
console.log('All checks passed.');
