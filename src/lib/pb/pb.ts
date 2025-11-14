import PocketBase from 'pocketbase';
type TypedPocketBase = PocketBase;

const pb = new PocketBase(
  import.meta.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'
) as TypedPocketBase;

// Désactiver le renouvellement auto des tokens pour le SSG
pb.autoCancellation(false);

export default pb;
