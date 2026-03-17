const {crc32} = require('@doctormckay/stdlib/hashing');

const Protos = require('../protobufs/generated/_load.js');

const {decodeProto} = require('./proto-decode.js');

/**
 * Attempts to decode an embedded/masked inspect link. Returns the datablock object on success, or null if cannot be
 * decoded or is malformed.
 *
 * @param {string} fullInspectLink
 * @return {object|null}
 */
exports.decode = function(fullInspectLink) {
	if (typeof fullInspectLink !== 'string') {
		throw new Error(`Incorrect type for inspectLink: expected 'string', got '${typeof fullInspectLink}'`);
	}

	let urlDecoded = decodeURIComponent(fullInspectLink);

	// We could use `new URL()` to properly parse the input, but we want to accept just the token from the end being passed
	// in, so just strip off any potential query string and call it a day.
	let queryIdx = urlDecoded.indexOf('?');
	if (queryIdx !== -1) {
		urlDecoded = urlDecoded.substring(0, queryIdx);
	}

	let parts = urlDecoded.trim().split(' ');
	if (parts.length < 2) {
		return null;
	}

	let inspectToken = parts[1].trim();
	if (!inspectToken.match(/^[0-9a-fA-F]+$/)) {
		// not hex
		return null;
	}

	let buffer = Buffer.from(inspectToken, 'hex');

	// demask
	let mask = buffer[0];
	// leave mask key unchanged; the checksum wants it
	for (let i = 1; i < buffer.length; i++) {
		buffer[i] ^= mask;
	}

	let expectedChecksum = buffer.readUInt32BE(buffer.length - 4);
	let checksum = calculateChecksum(buffer.slice(0, buffer.length - 4));

	if (checksum != expectedChecksum) {
		// bad checksum
		return null;
	}

	let result = decodeProto(Protos.CEconItemPreviewDataBlock, buffer.slice(1, buffer.length - 4));
	if (!result) {
		return null;
	}

	if (result.paintwear) {
		// convert wear from int to float
		let buf = Buffer.alloc(4);
		buf.writeUInt32BE(result.paintwear, 0);
		result.paintwear = buf.readFloatBE(0);
	}

	return result;
};

/**
 * @param {Buffer} fullBuffer - full input buffer, including mask byte but without checksum
 */
function calculateChecksum(fullBuffer) {
	let protoLen = fullBuffer.length - 1;

	let crc = crc32(fullBuffer);
	let encodedCrc = (crc & 0xFFFF) ^ (protoLen * crc);
	return (encodedCrc & 0xFFFFFFFF) >>> 0;
}
