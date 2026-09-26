# ghfind fish completion
# Source: source (ghfind --completion fish | psub)

complete -c ghfind -l json -d "JSON output"
complete -c ghfind -l csv -d "CSV output"
complete -c ghfind -l markdown -d "Markdown table output"
complete -c ghfind -l count -d "Only result count"
complete -c ghfind -l limit -d "Max results" -r
complete -c ghfind -l sort -d "Sort strategy" -r -f -a "best-match stars updated forks"
complete -c ghfind -l token -d "GitHub token" -r
complete -c ghfind -l trending -d "Trending mode"
complete -c ghfind -l language -d "Trending language filter" -r -f -a "rust python typescript javascript go c c++ c# java ruby php swift kotlin zig"
complete -c ghfind -l since -d "Trending period" -r -f -a "daily weekly monthly"
complete -c ghfind -l pipe -d "Pipe target" -r -f -a "clone open"
complete -c ghfind -l format -d "Output format" -r -f -a "urls names ssh-urls clone-commands ids"
complete -c ghfind -l registry -d "Registry for pkg" -r -f -a "npm"

complete -c ghfind -l watch -d "Watch mode"
complete -c ghfind -l interval -d "Watch interval seconds" -r
complete -c ghfind -l version -d "Print version"
complete -c ghfind -l help -d "Print help"
complete -c ghfind -l completion -d "Shell" -r -f -a "bash zsh fish"
complete -c ghfind -l as -d "Share format" -r -f -a "markdown plain gh-cli short"
complete -c ghfind -l remote -d "Skill search: query skills.sh instead of this machine"
complete -c ghfind -l local -d "Skill search: force the local scan (default)"
complete -c ghfind -l copy -d "Share: also copy the snippet to the clipboard"
complete -c ghfind -l raw -d "Readme: print the raw markdown with no header"

complete -c ghfind -f -a "login init doctor org user bookmarks history topics saved readme share pkg mcp skill trending deep-dive compare"