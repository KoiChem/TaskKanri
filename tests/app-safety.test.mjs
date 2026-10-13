import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('alarm execution is removed, rich text still retains legacy alarm markers',async()=>{
 const app=await readFile(new URL('../taskkanri-app.js',import.meta.url),'utf8');const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.equal(/checkAlarms|processAlarmHtml|startTitleBlink|closeAlarmModal/.test(app),false);assert.equal(html.includes('id="alarm-modal"'),false);assert.equal(html.includes('title="アラーム設定"'),false);
 const {sanitizeHtml}=await import('../taskkanri-core.mjs');assert.equal(sanitizeHtml('🔔 15:00 会議'),'🔔 15:00 会議');
});
