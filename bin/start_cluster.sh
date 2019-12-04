#!/bin/bash

HOSTSFILE=`dirname $BASH_SOURCE`/../etc/cluster_hosts

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
  ssh $f 'cd code/node-ispc; npm start' &
done

wait