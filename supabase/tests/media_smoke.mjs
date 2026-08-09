import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_TEST_URL;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY;
assert(url && publishableKey && secretKey, 'Missing local Supabase test configuration');

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, options);
const userClient = createClient(url, publishableKey, options);
const partnerClient = createClient(url, publishableKey, options);
const email = `media-smoke-${crypto.randomUUID()}@example.test`;
const partnerEmail = `media-partner-${crypto.randomUUID()}@example.test`;
const password = `Photo-${crypto.randomUUID()}-9a`;
let userId;
let partnerId;
let tripId;
let storagePath;

try {
  const { data: created, error: createUserError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createUserError) throw createUserError;
  userId = created.user.id;

  const { data: createdPartner, error: createPartnerError } = await admin.auth.admin.createUser({ email: partnerEmail, password, email_confirm: true });
  if (createPartnerError) throw createPartnerError;
  partnerId = createdPartner.user.id;

  const { error: signInError } = await userClient.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const { data: createdTrip, error: tripError } = await userClient.rpc('create_trip', {
    trip_title: 'Media smoke test',
    join_code: '0123456789abcdef'
  });
  if (tripError) throw tripError;
  tripId = createdTrip;
  const { error: partnerSignInError } = await partnerClient.auth.signInWithPassword({ email: partnerEmail, password });
  if (partnerSignInError) throw partnerSignInError;
  const { data: joinedTrip, error: joinError } = await partnerClient.rpc('join_trip', { join_code: '0123456789abcdef' });
  if (joinError) throw joinError;
  assert.equal(joinedTrip, tripId);
  storagePath = `${tripId}/photo/${crypto.randomUUID()}.png`;

  const image = await readFile(new URL('../../assets/icon-192.png', import.meta.url));
  const { error: uploadError } = await userClient.storage.from('trip-media').upload(storagePath, image, {
    contentType: 'image/png',
    upsert: false
  });
  if (uploadError) throw uploadError;

  const { data: media, error: metadataError } = await userClient.from('trip_media').insert({
    trip_id: tripId,
    kind: 'photo',
    activity_id: 'flight-it-1',
    storage_path: storagePath,
    mime_type: 'image/png',
    created_by: userId
  }).select('id,storage_path').single();
  if (metadataError) throw metadataError;
  assert.equal(media.storage_path, storagePath);

  const { data: partnerMedia, error: partnerReadError } = await partnerClient.from('trip_media')
    .select('id,activity_id,storage_path').eq('id', media.id).single();
  if (partnerReadError) throw partnerReadError;
  assert.equal(partnerMedia.activity_id, 'flight-it-1');

  const { data: signed, error: signedError } = await partnerClient.storage.from('trip-media').createSignedUrl(storagePath, 60);
  if (signedError) throw signedError;
  assert.match(signed.signedUrl, /^http/);

  const { error: removeObjectError } = await userClient.storage.from('trip-media').remove([storagePath]);
  if (removeObjectError) throw removeObjectError;
  storagePath = null;
  const { error: removeMetadataError } = await userClient.from('trip_media').delete().eq('id', media.id);
  if (removeMetadataError) throw removeMetadataError;

  console.log(JSON.stringify({ upload: true, partnerMetadataRead: true, partnerSignedRead: true, delete: true }));
} finally {
  if (storagePath) await admin.storage.from('trip-media').remove([storagePath]);
  if (tripId) await admin.from('trips').delete().eq('id', tripId);
  if (partnerId) await admin.auth.admin.deleteUser(partnerId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
