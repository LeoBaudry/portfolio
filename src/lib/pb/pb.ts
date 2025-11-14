import PocketBase from 'pocketbase';
type TypedPocketBase = PocketBase; 

let path = '';
if (import.meta.env.MODE === 'development') {
    //  LOCAL 
    path = 'http://127.0.0.1:8090'; 
} else {
    //  VPS
    path = 'http://127.0.0.1:????'; 
}

const pb = new PocketBase(path) as TypedPocketBase;

pb.autoCancellation(false);

export default pb;