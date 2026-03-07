#!/usr/bin/env bash
# AutoShop AI - Local Demo (Full Flow)
#
# Runs the complete SMS AI workflow without needing a real inbound SMS:
#   webhook -> AI prompt -> OpenAI gpt-4o-mini -> booking extraction -> Twilio send
#
# Twilio sends to the shop's own number (+13257523890) as a safe loop-back.
# The real Twilio MessageSid is returned in the response.
#
# Usage:
#   bash scripts/demo.sh
#   bash scripts/demo.sh "My brakes are grinding, need service Monday"
#   bash scripts/demo.sh "Need a battery replaced ASAP" "+15005550006"

MESSAGE="${1:-I need an oil change tomorrow at 10am}"
FROM="${2:-+15005550006}"
ENDPOINT="http://localhost:5678/webhook/demo-sms"

echo ""
echo "======================================"
echo " AutoShop AI - Full Flow Demo"
echo "======================================"
echo " Inbound SMS  : $MESSAGE"
echo " From         : $FROM"
echo " Twilio send  : +13257523890 (shop's own number)"
echo "======================================"
echo ""
echo "Running full pipeline (OpenAI + Twilio)..."
echo ""

RESPONSE=$(node -e "
const http = require('http');
const qs = require('querystring');

const body = qs.stringify({
  From: process.argv[1],
  Body: process.argv[2],
  MessageSid: 'SMdemo_' + Date.now()
});

const opts = {
  hostname: 'localhost', port: 5678,
  path: '/webhook/demo-sms', method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body)
  },
  timeout: 25000
};

const req = http.request(opts, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => { process.stdout.write(data); });
});
req.on('error', e => { process.stderr.write('ERROR: ' + e.message + '\n'); process.exit(1); });
req.on('timeout', () => { req.destroy(); process.stderr.write('ERROR: Timed out after 25s\n'); process.exit(1); });
req.write(body);
req.end();
" "$FROM" "$MESSAGE" 2>&1)

EXIT=$?
if [ $EXIT -ne 0 ] || [ -z "$RESPONSE" ]; then
  echo "ERROR: No response. Is the stack running?"
  echo "  cd infra && docker compose up -d"
  exit 1
fi

node -e "
const r = JSON.parse(process.argv[1]);
const L = '--------------------------------------';
console.log(L);
console.log('INBOUND MESSAGE  :', r.inbound_message);
console.log('FROM             :', r.from);
console.log(L);
console.log('AI REPLY         :', r.ai_reply);
console.log(L);
console.log('booking_intent   :', r.booking_intent);
console.log('service_type     :', r.service_type);
console.log('requested_time   :', r.requested_time_text || '(not specified)');
console.log('needs_more_info  :', r.needs_more_info);
console.log('calendar_summary :', r.calendar_summary);
console.log(L);
console.log('twilio_to        :', r.twilio_to);
console.log('twilio_sid       :', r.twilio_message_sid);
console.log('twilio_status    :', r.twilio_status);
if (r.twilio_error) console.log('twilio_error     :', r.twilio_error);
console.log(L);
console.log('model            :', r.model);
console.log(L);
console.log('');
console.log('FULL JSON:');
console.log(JSON.stringify(r, null, 2));
" "$RESPONSE"
