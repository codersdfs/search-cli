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
    '--as[Share format]:(markdown plain gh-cli short)'
    '--remote[Skill search: query skills.sh instead of this machine]'
    '--local[Skill search: force the local scan (default)]'
    '--copy[Share: also copy the snippet to the clipboard]'
    '--raw[Readme: print the raw markdown with no header]'

    'login[Import a GitHub token from the gh CLI or paste one]'
    'init[Run the setup wizard]'
    'doctor[Environment diagnostics]'
    'org[Org profile]:org name:'
    'user[User profile]:user name:'
    'bookmarks[List saved repos]:query:'
    'history[List past searches]:query:'
    'topics[Browse popular GitHub topics]'
    'saved[List saved searches]'
    'readme[Print a repository README]:owner/repo:'
    'share[Print a share snippet]:owner/repo:'
    'pkg[Search packages]:query:'
    'trending[Trending repos, optionally by language]'
    'deep-dive[Repo deep-dive: languages, contributors, README]:owner/repo:'
    'mcp[Run the MCP server for AI agents (stdio)]'
    'skill[Print an agent skill guide, or search with: skill search <query>]:skill name:'
    'compare[Compare repositories]'
  )
  _arguments "${opts[@]}" '*:query:'
}

compdef _ghfind ghfind