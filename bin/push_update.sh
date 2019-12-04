#!/bin/bash

HOSTSFILE=`dirname $BASH_SOURCE`/../etc/push_hosts

HOSTS=$(
  for f in $(
    exec 3< $HOSTSFILE
    while read -u 3 host
    do
      if [[ $host == "" || $host = "#"* ]]
      then
        continue
      fi
      echo $host
    done)
  do 
    echo $f
  done
)

for f in $HOSTS
do 
  (
    git push $f:code/node-ispc master-remote:master-remote; 
    ssh $f 'cd code/node-ispc; git merge master-remote; if which yarn; then yarn; else npm i; fi'
  ) &
done

wait

