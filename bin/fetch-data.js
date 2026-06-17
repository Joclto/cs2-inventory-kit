#!/usr/bin/env node

/**
 * cs2-inventory-kit-fetch
 *
 * Force-update item schema data from ByMykel/counter-strike-file-tracker.
 *
 * Usage:
 *   npx cs2-inventory-kit-fetch           Check SHA + 24h, download if needed
 *   npx cs2-inventory-kit-fetch --force   Force re-download all files
 *
 * Environment:
 *   CS2_SCHEMA_DIR  Custom data directory (default: ./cs2-inventory-schema)
 */

const { DataLoader } = require('../enricher/data-loader.js');
const path = require('path');

const dataDir = process.env.CS2_SCHEMA_DIR || path.join(process.cwd(), 'cs2-inventory-schema');
const force = process.argv.includes('--force');

console.log('[cs2-inventory-kit] Data directory: ' + dataDir);
if (force) {
	console.log('[cs2-inventory-kit] Force update enabled');
}

const loader = new DataLoader(dataDir);
loader.load({ forceUpdate: force })
	.then((data) => {
		console.log('[cs2-inventory-kit] Data updated successfully');
		console.log('[cs2-inventory-kit] Manifest ID: ' + (data.manifestId || 'unknown'));
		console.log('[cs2-inventory-kit] Location: ' + dataDir);
	})
	.catch((err) => {
		console.error('[cs2-inventory-kit] Update failed: ' + err.message);
		process.exit(1);
	});
