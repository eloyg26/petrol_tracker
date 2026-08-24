import json, feedparser
url='https://news.google.com/rss/search?q=precio+gasolina+sube+espana&hl=es&gl=ES&ceid=ES:es'
feed=feedparser.parse(url)
print('entries', len(feed.entries))
for e in feed.entries[:3]:
    print('TITLE:', e.get('title'))
    print('SOURCE:', e.get('source'))
    print('SUM:', (e.get('summary') or e.get('description') or '')[:160])
    print('---')
