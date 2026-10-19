import test from 'node:test';
import assert from 'node:assert/strict';
import {importErrorMessage} from '../taskkanri-transfer-errors.mjs';
test('a file read failure with an empty native message still explains the reason and stage',()=>{const message=importErrorMessage(new DOMException('','NotReadableError'),'read');assert.match(message,/ファイル/);assert.match(message,/保存/);assert.match(message,/TK-IMPORT-READ/);assert.match(message,/NotReadableError/)});
test('quota failures explain storage without claiming import was completed',()=>{const message=importErrorMessage(new DOMException('','QuotaExceededError'),'prepare');assert.match(message,/容量/);assert.match(message,/TK-IMPORT-PREPARE/)});
test('unknown thrown values still yield a nonempty actionable reason',()=>{for(const error of [undefined,null,{},new Error(''),'読み取り失敗']){const message=importErrorMessage(error,'preview');assert.match(message,/差分/);assert.match(message,/TK-IMPORT-PREVIEW/);assert.ok(message.length>30)}});
test('explicit validation messages are retained',()=>{assert.match(importErrorMessage(new Error('未対応の形式です'),'validate'),/未対応の形式です/)});
