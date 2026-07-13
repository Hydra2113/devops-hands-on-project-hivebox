import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

// Unlike the cache, storage is NOT fail-open: a snapshot that fails to write
// is real data loss, so errors propagate to the caller.
const BUCKET = process.env.S3_BUCKET ?? 'hivebox';

const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1', // required by the SDK; MinIO accepts anything
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    },
    // MinIO serves buckets as paths (host/bucket), not subdomains (bucket.host).
    forcePathStyle: true,
});

// Create the bucket on first use; memoized so it runs once per process.
let bucketReady;
function ensureBucket() {
    bucketReady ??= s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
        .catch(() => s3.send(new CreateBucketCommand({ Bucket: BUCKET })));
    return bucketReady;
}

// Write one JSON snapshot; returns the object key it was stored under.
export async function putSnapshot(data) {
    await ensureBucket();
    // Colons are legal in S3 keys but awkward in URLs/consoles, so 12:34:56 -> 12-34-56.
    const key = `temperature/${new Date().toISOString().replaceAll(':', '-')}.json`;
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: 'application/json',
    }));
    return key;
}
