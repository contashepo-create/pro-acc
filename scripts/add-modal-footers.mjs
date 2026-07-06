import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function findPageFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPageFiles(fullPath));
    } else if (entry.name === 'page.tsx') {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findPageFiles('src/app/(dashboard)');

for (const file of files) {
  let content = readFileSync(file, 'utf-8');
  const original = content;

  // Check if this file has a Modal with showModal
  if (!content.includes('<Modal') || !content.includes('showModal')) {
    continue;
  }

  // Add Button import if not already present
  if (!content.includes("from '@/components/ui/Button'")) {
    content = content.replace(
      /(from '@\/components\/ui\/Modal')/,
      "$1\nimport { Button } from '@/components/ui/Button'"
    );
  }

  // Replace Modal opening tags with footer prop.
  // Matches: <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="..." size="...">
  // The footer is inserted before the final >
  const modalRegex = /(<Modal\s+isOpen=\{showModal\}\s+onClose=\{\(\)\s*=>\s*setShowModal\(false\)\}\s+title="[^"]*"(?:\s+size="[^"]*")?)\s*>/g;
  const replacement = '$1 footer={<div className="flex items-center gap-2"><Button variant="ghost" onClick={() => setShowModal(false)}>إلغاء</Button><Button onClick={() => {}}>حفظ</Button></div>}>';

  const newContent = content.replace(modalRegex, replacement);
  
  if (newContent !== original) {
    writeFileSync(file, newContent);
    console.log(`✓ ${file}`);
  }
}
console.log('Done');
