TOOL_DEFINITIONS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "bash_exec",
            "description": (
                "Execute a bash command in the project workspace directory. "
                "Use for: running tests, building the project, checking syntax, "
                "installing packages, inspecting directory structure. "
                "stdout and stderr are both captured and returned."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to run. Runs with cwd=workspace.",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Max seconds to wait. Defaults to 60.",
                        "default": 60,
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": (
                "Read the full contents of a file in the workspace. "
                "Path is relative to the workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from workspace root, e.g. 'src/App.jsx'",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": (
                "Write (or overwrite) a file in the workspace. "
                "Creates parent directories automatically. "
                "Path is relative to the workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path from workspace root, e.g. 'src/App.jsx'",
                    },
                    "content": {
                        "type": "string",
                        "description": "Full file content to write",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": (
                "List files and directories at a given path in the workspace. "
                "Returns a formatted tree. Path is relative to workspace root."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path to list. Defaults to '.' (workspace root).",
                        "default": ".",
                    },
                },
                "required": [],
            },
        },
    },
]
