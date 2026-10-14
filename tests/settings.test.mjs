import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDateRows, parseBulkDateRows, summarizeTimetableChanges, planSettingsDateMaps, formatBulkDateText} from '../taskkanri-settings.mjs';
test('date rows reject duplicates and outside-year dates atomically',()=>{
 assert.throws(()=>validateDateRows([{date:'2026-04-01',name:'A'},{date:'2026-04-01',name:'B'}],2026),/重複/);
 assert.throws(()=>validateDateRows([{date:'2027-04-01',name:'A'}],2026),/年度内/);
 assert.equal(validateDateRows([{date:'2026-04-01',name:'<b>A</b>'}],2026)['2026-04-01'],'&lt;b&gt;A&lt;/b&gt;');
});
test('bulk input retains errors with line numbers',()=>{
 assert.throws(()=>parseBulkDateRows('260401:A\nbad',2026),/2行目/);
 assert.deepEqual(parseBulkDateRows('260401:A',2026),[{date:'2026-04-01',name:'A'}]);
});
test('editing one bulk event preserves unchanged rich content and other years',()=>{
 const rich='<b>職員会議</b><br>会議室';
 const state={currentYear:2026,configEvents:{'2026-10-14':rich,'2026-10-15':'旧行事','2027-04-01':'次年度'},customHolidays:{}};
 assert.equal(formatBulkDateText(state.configEvents,2026),'261014:職員会議 会議室\n261015:旧行事');
 const rows=parseBulkDateRows('261014:職員会議 会議室\n261015:新行事',2026,state.configEvents);
 const next=planSettingsDateMaps(state,{events:rows});
 assert.deepEqual(next.configEvents,{'2026-10-14':rich,'2026-10-15':'新行事','2027-04-01':'次年度'});
 assert.equal(state.configEvents['2026-10-15'],'旧行事');
});
test('bulk duplicate errors refer to physical lines including blank lines',()=>{
 assert.throws(()=>parseBulkDateRows('261014:A\n\n261014:B',2026),/3行目.*重複/);
});
test('bulk date entry resolves calendar years across the supported century boundary',()=>{
 assert.deepEqual(parseBulkDateRows('991014:行事\n000114:年度末行事',2099),[{date:'2099-10-14',name:'行事'},{date:'2100-01-14',name:'年度末行事'}]);
 assert.deepEqual(parseBulkDateRows('000401:行事\n010114:年度末行事',2100),[{date:'2100-04-01',name:'行事'},{date:'2101-01-14',name:'年度末行事'}]);
});
test('preview counts deletes and task replacements',()=>{
 const value=summarizeTimetableChanges([{dateId:'2026-04-01',slot:'朝',before:'<span class="todo-badge">a</span>',after:''},{dateId:'2026-04-01',slot:'１限',before:'',after:'B'}]);
 assert.deepEqual(value,{days:1,slots:2,deleted:1,tasks:1});
});
test('settings validation rejects whole transaction and preserves other years',async()=>{
 const {planSettingsDateMaps}=await import('../taskkanri-settings.mjs');
 const state={currentYear:2026,configEvents:{'2025-06-01':'old','2026-04-01':'existing'},customHolidays:{'2027-05-01':'next'}};
 const before=structuredClone(state);
 assert.throws(()=>planSettingsDateMaps(state,{events:[{date:'2026-04-02',name:'new'}],holidays:[{date:'2026-02-01',name:'bad'}]}),/年度内/);
 assert.deepEqual(state,before);
 const next=planSettingsDateMaps(state,{events:[{date:'2026-04-02',name:'new'}],holidays:[]});
 assert.deepEqual(next.configEvents,{'2025-06-01':'old','2026-04-02':'new'});
 assert.deepEqual(next.customHolidays,{'2027-05-01':'next'});
});

test('unrelated settings and unchanged rows preserve original rich event and holiday text',async()=>{
 const {planSettingsDateMaps}=await import('../taskkanri-settings.mjs');const rich='<b>職員会議</b><br>会議室';
 const state={currentYear:2026,configEvents:{'2026-10-14':rich},customHolidays:{'2026-10-15':'<b>休日</b>'}};
 assert.deepEqual(planSettingsDateMaps(state,{}),{configEvents:state.configEvents,customHolidays:state.customHolidays});
 const next=planSettingsDateMaps(state,{events:[{date:'2026-10-14',name:'職員会議会議室',originalDate:'2026-10-14',originalName:'職員会議会議室',originalHtml:rich},{date:'2026-10-16',name:'新規'}]});
 assert.equal(next.configEvents['2026-10-14'],rich);assert.equal(next.configEvents['2026-10-16'],'新規');assert.equal(next.customHolidays['2026-10-15'],'<b>休日</b>');
});
