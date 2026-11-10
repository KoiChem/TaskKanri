import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeHtml,stripHtml} from '../taskkanri-core.mjs';

test('normal-colour whitespace-only spans are unwrapped without changing whitespace',()=>{
 const html='前<span style="font-weight:normal;color:#2d3748">&nbsp; </span>後<span style="color:rgb(45, 55, 72);font-weight:normal">&#160;</span>';
 const result=sanitizeHtml(html);
 assert.equal(result,'前&nbsp; 後&#160;');
 assert.equal(stripHtml(result),stripHtml(html));
 assert.equal(sanitizeHtml(result),result);
});

test('compaction preserves text styling, highlights, decorations, nested content, line breaks and task badges',()=>{
 const cases=[
  '<span style="font-weight:normal;color:#2d3748">本文</span>',
  '<span style="background-color:yellow">&nbsp;</span>',
  '<span style="font-weight:bold;color:#1e3a8a">①</span>',
  '<span style="color:red">&nbsp;</span>',
  '<span style="color:#2d3748;text-decoration:line-through">&nbsp;</span>',
  '<span style="font-weight:normal;color:#2d3748"><br></span>',
  '<span style="font-weight:normal;color:#2d3748"><b> </b></span>',
  '<span class="todo-badge state-0" data-state="0" style="font-weight:normal;color:#2d3748">未</span>'
 ];
 for(const html of cases)assert.equal(sanitizeHtml(html),html);
});

test('removing empty style wrappers cannot expose unsafe markup or change text spacing',()=>{
 const html='<span style="font-weight:normal;color:#2d3748">&nbsp;\t</span><script>bad()</script><img src=x onerror=bad()>本文';
 assert.equal(sanitizeHtml(html),'&nbsp;\t本文');
});

test('nested whitespace-only default wrappers compact in one pass and remain idempotent',()=>{
 const html='<span style="font-weight:normal;color:#2d3748"><span style="font-weight:normal;color:#2d3748">&nbsp;</span></span>';
 assert.equal(sanitizeHtml(html),'&nbsp;');
});
