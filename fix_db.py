with open('D:\\Code\\Event\\eventmanagerdesktop\\src-tauri\\src\\db.rs', 'r') as f:
    content = f.read()
old = 'map_err(|e| rusqlite::Error::QueryGenerationFailed(e.to_string())?'
new = 'map_err(|e| -> rusqlite::Error { e.into() })?'
if old in content:
    content = content.replace(old, new)
    with open('D:\\Code\\Event\\eventmanagerdesktop\\src-tauri\\src\\db.rs', 'w') as f:
        f.write(content)
    print('Replacement done')
else:
    print('Old string not found')
    # Debug: show lines around 189
    lines = content.split('\n')
    for i, line in enumerate(lines[187:192], 188):
        print(f'{i}: {repr(line)}')