# ghfind zsh completion
# Source: source <(ghfind --completion zsh)

_ghfind() {
  local -a opts
  opts=(
    '--json[JSON output]'
    '--csv[CSV output]'
    '--markdown[Markdown table output]'
    '--count[Only result count]'
    '--limit[Max results]:limit:'
    '--sort[Sort strategy]:(best-match stars updated forks)'
    '--token[GitHub token]:token:'
    '--trending[Trending mode]'
    '--language[Trending language filter]:language:'
    '--since[Trending period]:(daily weekly monthly)'
    '--pipe[Pipe target]:(clone open)'
    '--format[Output format]:(urls names ssh-urls clone-commands ids)'
    '--registry[Registry for pkg]:(npm)'

    '--watch[Watch mode]'
    '--interval[Watch interval seconds]:seconds:'
    '--version[Print version]'
    '--help[Print help]'
    '--completion[Shell]:(bash zsh fish)'

    'login[Import a GitHub token from the gh CLI or paste one]'
    'init[Run the setup wizard]'
    'doctor[Environment diagnostics]'
    'org[Org profile]:org name:'
    'pkg[Search packages]:query:'
    'trending[Trending repos, optionally by language]'
    'deep-dive[Repo deep-dive: languages, contributors, README]:owner/repo:'
    'mcp[Run the MCP server for AI agents (stdio)]'
    'skill[Print an agent skill guide]:skill name:'
  )
  _arguments "${opts[@]}" '*:query:'
}

compdef _ghfind ghfind