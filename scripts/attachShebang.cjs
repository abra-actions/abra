const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, '..', 'dist', 'index.js');
const shebang = '#!/usr/bin/env node\n';

fs.readFile(outputFile, 'utf8', (err, data) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  if (!data.startsWith('#!')) {
    const newData = shebang + data;
    fs.writeFile(outputFile, newData, 'utf8', err => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.log('Shebang attached successfully.');
    });
  } else {
    console.log('Shebang already present.');
  }
});
