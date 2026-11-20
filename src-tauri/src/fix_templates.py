content = open(r'D:\Code\Event\eventmanagerdesktop\src-tauri\src\templates.rs', 'r', encoding='utf-8').read()
old = 'serde_json::json!([]).as_array().cloned().unwrap_or_default()'
new = 'vec![]'
count = content.count(old)
if count > 0:
    content = content.replace(old, new)
    open(r'D:\Code\Event\eventmanagerdesktop\src-tauri\src\templates.rs', 'w', encoding='utf-8').write(content)
    print('Replaced ' + str(count) + ' occurrences')
else:
    print('No occurrences found')