import requests
import json

PROJECT_ID = "museumaker-79294"
FIRESTORE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/museums"
GREENBASE_UPLOAD = "https://greenbase.arielcapdevila.com/upload"
GREENBASE_FILE = "https://greenbase.arielcapdevila.com/file/"

def migrate():
    print("Starting migration from yyf.mubilop.com to greenbase.arielcapdevila.com...")
    res = requests.get(FIRESTORE_URL)
    if not res.ok:
        print("Error fetching museums", res.text)
        return
    
    data = res.json()
    if 'documents' not in data:
        print("No documents found in DB.")
        return
        
    for doc in data['documents']:
        doc_id = doc['name'].split('/')[-1]
        fields = doc.get('fields', {})
        
        if 'data' in fields and 'stringValue' in fields['data']:
            museum_data_str = fields['data']['stringValue']
            try:
                museum_data = json.loads(museum_data_str)
            except json.JSONDecodeError:
                continue
            
            needs_update = False
            for art in museum_data.get('artData', []):
                content = art.get('content', '')
                if 'yyf.mubilop.com' in content:
                    print(f"Migrating {content} in museum {doc_id}...")
                    
                    try:
                        img_res = requests.get(content, timeout=10)
                        if img_res.ok:
                            files = {'file': ('image.jpg', img_res.content, 'image/jpeg')}
                            up_res = requests.post(GREENBASE_UPLOAD, files=files, timeout=15)
                            if up_res.ok:
                                up_data = up_res.json()
                                new_url = GREENBASE_FILE + up_data['id']
                                art['content'] = new_url
                                needs_update = True
                                print(f" -> Success: {new_url}")
                            else:
                                print(f" -> Failed to upload: {up_res.text}")
                        else:
                            print(f" -> Failed to download: {img_res.status_code}")
                    except Exception as e:
                        print(f" -> Error processing {content}: {e}")
            
            if needs_update:
                new_data_str = json.dumps(museum_data)
                
                update_url = f"{FIRESTORE_URL}/{doc_id}?updateMask.fieldPaths=data"
                payload = {
                    "fields": {
                        "data": {
                            "stringValue": new_data_str
                        }
                    }
                }
                patch_res = requests.patch(update_url, json=payload)
                if patch_res.ok:
                    print(f"Successfully updated museum data for {doc_id} in Firestore.")
                else:
                    print(f"Failed to update {doc_id} in Firestore: {patch_res.text}")

if __name__ == '__main__':
    migrate()
