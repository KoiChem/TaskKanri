import { build } from 'esbuild';
import {mkdir,rm,copyFile,writeFile} from 'node:fs/promises';
const files=['taskkanri-transfer-errors.mjs','taskkanri-import.mjs','taskkanri-export.mjs','taskkanri-transfer-ui.js','index.html','taskkanri-app.js','taskkanri-core.mjs','taskkanri-timetable.mjs','taskkanri-settings.mjs','settings-ui.css','taskkanri-sync-model.mjs','taskkanri-sync-engine.mjs','taskkanri-device-storage.mjs','taskkanri-sync.js','taskkanri-sync-ui.js','sync-ui.css','supabase-config.js','mobile.html','mobile.css','mobile-app.js','mobile-model.mjs','mobile-ui.mjs','mobile-editor-model.mjs','mobile-editor.js','mobile-slot-editor.js','mobile-incomplete.js'];
await rm('dist',{recursive:true,force:true});await mkdir('dist/vendor',{recursive:true});await mkdir('vendor',{recursive:true});
await build({stdin:{contents:"export {createClient} from '@supabase/supabase-js';",resolveDir:process.cwd(),sourcefile:'supabase-entry.js'},bundle:true,format:'esm',platform:'browser',target:'safari15',outfile:'vendor/supabase.js',minify:true,legalComments:'eof'});
await copyFile('vendor/supabase.js','dist/vendor/supabase.js');
for(const file of files)await copyFile(file,'dist/'+file);
for(const entry of ['taskkanri-app.js','mobile-app.js'])await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',target:'safari15',outfile:'dist/'+entry,legalComments:'eof'});
await writeFile('dist/.nojekyll','');console.log('Built public assets only: '+files.length+' files + bundled SDK');
