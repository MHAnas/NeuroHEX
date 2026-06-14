# run_once_save_demo.py  (run from your project root)
import requests, json, base64, pathlib

BACKEND = "http://localhost:8000"
MRI_PATH = "public/demo/demo_brain.nii.gz"

print("Sending to SynthSeg...")
with open(MRI_PATH, "rb") as f:
    r = requests.post(f"{BACKEND}/segment", files={"file": f}, timeout=300)
r.raise_for_status()
pathlib.Path("public/demo/demo_seg.nii").write_bytes(r.content)
print(f"Saved demo_seg.nii ({len(r.content)//1024} KB)")

print("Sending to BraTS tumor screening...")
with open(MRI_PATH, "rb") as f:
    r2 = requests.post(f"{BACKEND}/tumor", files={"file": f}, timeout=300)
if r2.ok:
    pathlib.Path("public/demo/demo_tumor.json").write_text(r2.text)
    print("Saved demo_tumor.json")
else:
    # Save a "none" result so the demo still works offline
    fallback = {
        "classification": "none",
        "edema_cm3": 0, "enhancing_cm3": 0, "necrotic_cm3": 0,
        "total_tumor_cm3": 0, "label_nii_b64": None,
        "model": "BraTS 2020", "citation": "Menze et al. IEEE TMI 2015"
    }
    pathlib.Path("public/demo/demo_tumor.json").write_text(json.dumps(fallback))
    print("Saved demo_tumor.json (fallback — tumor endpoint unavailable)")

print("Done. Files saved to public/demo/")