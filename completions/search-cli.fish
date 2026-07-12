# search-cli fish completion
# Source: source <(search-cli --completion fish)

complete -c search-cli -l json -d "JSON output"
complete -c search-cli -l csv -d "CSV output"
complete -c search-cli -l markdown -d "Markdown table output"
complete -c search-cli -l count -d "Only result count"
complete -c search-cli -l limit -d "Max results" -r
complete -c search-cli -l sort -d "Sort strategy" -r -f -a "best-match stars updated forks"
complete -c search-cli -l token -d "GitHub token" -r
complete -c search-cli -l trending -d "Trending mode"
complete -c search-cli -l since -d "Trending period" -r -f -a "daily weekly monthly"
complete -c search-cli -l pipe -d "Pipe target" -r -f -a "clone open"
complete -c search-cli -l format -d "Output format" -r -f -a "urls names ssh-urls clone-commands ids"
complete -c search-cli -l watch -d "Watch mode"
complete -c search-cli -l interval -d "Watch interval seconds" -r
complete -c search-cli -l version -d "Print version"
complete -c search-cli -l help -d "Print help"
complete -c search-cli -l completion -d "Shell" -r -f -a "bash zsh fish"
