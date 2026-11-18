#!/usr/bin/env python3
"""Package unity/KitsuNexusTracking as a VRChat Creator Companion (VPM) package.

Writes into OUT_DIR:
  com.nekosuneprojects.kitsunexus.tracking-<version>.zip   the package (package.json at the zip root)
  vpm.json                                                  a VPM repository listing for it

The package gets the app's release version, so every KitsuNexus release ships a matching
Unity tool. Users add the listing once in VCC (Settings > Packages > Add Repository):
  https://github.com/<repo>/releases/latest/download/vpm.json

Usage: build-vpm.py <version> <owner/repo> <out_dir>
Standard library only (runs on the release runner as-is).
"""
import hashlib
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG_DIR = os.path.join(ROOT, 'unity', 'KitsuNexusTracking')


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    version, repo, out_dir = sys.argv[1].lstrip('v'), sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(PKG_DIR, 'package.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    name = manifest['name']
    zip_name = f'{name}-{version}.zip'
    base = f'https://github.com/{repo}/releases'
    manifest['version'] = version
    manifest['url'] = f'{base}/download/v{version}/{zip_name}'

    zip_path = os.path.join(out_dir, zip_name)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, _dirs, files in os.walk(PKG_DIR):
            for fn in sorted(files):
                full = os.path.join(folder, fn)
                rel = os.path.relpath(full, PKG_DIR).replace(os.sep, '/')
                if rel == 'package.json':
                    continue  # written below with the release version + url
                z.write(full, rel)
        z.writestr('package.json', json.dumps(manifest, indent=2) + '\n')

    with open(zip_path, 'rb') as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    entry = dict(manifest, zipSHA256=sha)
    listing = {
        'name': 'KitsuNexus',
        'id': 'com.nekosuneprojects.kitsunexus',
        'url': f'{base}/latest/download/vpm.json',
        'author': manifest.get('author', {}).get('name', 'NekoSuneVR'),
        'packages': {name: {'versions': {version: entry}}},
    }
    with open(os.path.join(out_dir, 'vpm.json'), 'w', encoding='utf-8') as f:
        json.dump(listing, f, indent=2)
        f.write('\n')
    print(f'{zip_name}  sha256 {sha}')
    print(f'listing: {listing["url"]}')


if __name__ == '__main__':
    main()
